/**
 * Letsplay engine — the agent's structured belief state (dev-only).
 *
 * The agent is a POMDP solver: {@link observe} is **egocentric** (it only reports
 * what the player can perceive *right now*), so to play like a human the agent
 * must **remember** what it has seen across steps. {@link AgentMemory} is that
 * memory — an explicit, inspectable "notebook" the agent carries for the run and
 * updates **only** from observations, never from omniscient engine state:
 *
 *  - **`priceBook`** — `planetId → (good → last-seen buy/sell + `seenAt`)`. The
 *    only prices that exist are those of a planet the agent has *landed on*; an
 *    unvisited planet is simply absent. This is what lets the agent reason
 *    "I saw METALS sell high at planet B" without re-reading the engine.
 *  - **`inventoryLots`** — held cargo tagged with the **price it was bought at**
 *    (FIFO), so the agent can compute sell-for-profit ("I paid 100, B buys at 160").
 *  - **`threatMap`** — `systemId → remembered danger` (the worst hostile presence
 *    seen there), so a route can be planned *around* a known-dangerous system.
 *  - **`knownOffers`** — upgrade/equipment offers the agent has seen and where.
 *    (No observation surfaces shop offers yet, so this is carried but unpopulated
 *    until {@link observe} exposes them — it is never invented.)
 *
 * Everything here is **pure** and **per-run**: {@link createMemory} starts a fresh
 * notebook each new game (a human starting over), and {@link updateMemory} folds a
 * single {@link Observation} into a **new** memory without mutating the input. It
 * never stores a fact the observation did not contain. Lives under `src/tests/`
 * and is dev-only.
 */
import { SceneType, type ResourceType } from "@/types";
import type { Observation } from "./observe";
import { logger } from "@/utils/logger";
import type { GameEngine } from "@/systems/GameEngine";

/** One good's last-seen prices at a planet, stamped with when it was seen. */
export interface PriceRecord {
  /** Price to buy one unit at that planet, as last observed. */
  buy: number;
  /** Price to sell one unit at that planet, as last observed. */
  sell: number;
  /** The memory step at which this price was last refreshed (re-seeing bumps it). */
  seenAt: number;
}

/**
 * A parcel of held cargo tagged with the price each unit was bought at. Lots are
 * FIFO: a sell drains the oldest lots first, so the buy-price of what remains is
 * always known for a sell-for-profit decision.
 */
export interface InventoryLot {
  good: ResourceType;
  qty: number;
  /** Per-unit price paid. `0` for cargo gained without a visible market price (loot). */
  buyPrice: number;
}

/** A known upgrade/equipment offer and where it was seen. */
export interface KnownOffer {
  /** Catalog id of the offered item (gear / hull / micromodule). */
  item: string;
  /** Asking price, as observed. */
  price: number;
  /** The location (planet / station id) the offer was seen at. */
  location: string;
}

/** One carried quest's known delivery target, mirrored from the observation. */
export interface ActiveQuestDelivery {
  questId: string;
  targetSystemId: string;
}

/** Hull fraction at/below which the deadlock detector's hull condition holds. */
export const DEADLOCK_HULL_FRACTION = 0.1;
/** Credit balance below which the deadlock detector's credit condition holds. */
export const DEADLOCK_MIN_CREDITS = 100;

/**
 * The agent's per-run belief state. The four head fields mirror the plan's
 * notebook; `lastCargo`/`step` are internal bookkeeping {@link updateMemory} uses
 * to detect buys/sells and to stamp `seenAt`.
 */
export interface AgentMemory {
  /** planetId → (resource → last-seen prices). Only landed planets appear. */
  priceBook: Map<string, Map<ResourceType, PriceRecord>>;
  /** Held cargo lots with the price each was bought at (FIFO for sell-profit). */
  inventoryLots: InventoryLot[];
  /** systemId → remembered danger (max hostile count ever seen in that system). */
  threatMap: Map<string, number>;
  /**
   * planetId → the systemId it was SEEN in (every planet of every visited
   * system — planet lists are system-scene-visible, no landing needed). The
   * egocentric "where was that planet again" a human keeps: it lets the
   * ladder route BACK to a remembered cheap-buy planet across systems
   * (`go-restock`, Task 7) instead of only ever exploring outward. Bounded by
   * the galaxy's planet count, like `priceBook`.
   */
  planetSystems: Map<string, string>;
  /** Known upgrade/equipment offers, by location (populated once observed). */
  knownOffers: KnownOffer[];
  /** Internal: last observed cargo amounts, used to diff buys vs sells. */
  lastCargo: Map<ResourceType, number>;
  /** Internal: monotonic step counter; stamps `seenAt` so re-seeing advances it. */
  step: number;
  /** systemIds the run has actually been in (the current system, each step). */
  visitedSystemIds: Set<string>;
  /** Internal: the last system observed, used to detect a warp (system change) with no landing since. */
  lastSystemId: string | null;
  /**
   * Internal: the `currentPlanet` id observed on the immediately-previous fold
   * (`null` if not landed then) — NOT a sticky "last visited planet", it goes
   * stale after a single fold. Lets a buy detected one fold after leaving a
   * planet still resolve its real buy price from the price book instead of
   * falling back to `0`: the live autopilot's `openTrade` executes the trade
   * then transitions straight to SPACE_FLIGHT (no intervening PLANET fold), so
   * the inventory delta is only visible on the *next* fold, by which point
   * `obs.currentPlanet` is already null.
   */
  lastCurrentPlanetId: string | null;
  /**
   * Internal: the system observed one fold *before* {@link lastSystemId} — i.e.
   * genuinely "where the ship just came from". Distinct from `lastSystemId`,
   * which is overwritten to the *current* system by the end of every fold and
   * so can't itself answer "where were we a moment ago" once decision-time
   * arrives. Feeds the Task 5 warp-target picker's anti-ping-pong tie-break
   * (don't warp straight back to the system just left).
   */
  previousSystemId: string | null;
  /**
   * Internal: a short rolling history of recently-departed system ids
   * (most-recent-first, bounded to {@link RECENT_SYSTEM_IDS_MAX}), pushed
   * alongside {@link previousSystemId} on every genuine system change.
   * Unlike `previousSystemId` (one step back), this survives more than one
   * hop — `pickFrontwardNeighbor`'s slayer-advance tie-break needs it because
   * a single-step anti-backtrack doesn't stop a hub/triangle topology from
   * ping-ponging between two-or-more tied neighbours forever (F1, live-session
   * finding: sys_22↔14↔23 bounced 173 times around a hub).
   */
  recentSystemIds: string[];
  /**
   * Internal: consecutive genuine system-changes that land on a system
   * already in {@link recentSystemIds} — the backstop for a topology where
   * `pickFrontwardNeighbor`'s recency tie-break still can't escape (every
   * neighbour of every system in the cycle is itself in the recent history).
   * Resets to 0 on a system change that is NOT a revisit. `MemoryHeuristicPolicy`
   * reads this to stand the slayer-advance tier down once it crosses
   * `FRONT_CYCLE_STREAK_LIMIT`, treating the front as not genuinely reachable
   * this tick instead of looping forever.
   */
  frontCycleStreak: number;
  /** Count of system-to-system hops since the last landing — the anti-warp-loop cadence signal. */
  consecutiveWarpsWithoutLanding: number;
  /** The player's known outstanding loan, or absent when none is carried. */
  loanState?: { balance: number; missedPayments: number };
  /** Sticky once true — the compound worst-case state was seen this run (logged once). */
  deadlockDetected: boolean;
  /** Currently-carried quests with a known delivery system, mirrored from the observation. */
  activeQuestDelivery: ActiveQuestDelivery[];
  /** Credits as of the most recent day-boundary fold (the "yesterday" baseline for stagnation detection). */
  creditYesterday: number;
  /** Consecutive day-boundaries where credits did not exceed {@link creditYesterday} — the stagnation signal. */
  daysWithoutCreditGain: number;
  /** Count of day-boundaries folded while `overmindShare > 0` — a duration proxy for Overmind pressure. */
  overmindDaysSeen: number;
  /** Internal: the last `obs.gameDay` folded, used to detect a day-boundary transition. `-1` = no day seen yet. */
  lastDaySeen: number;
  /**
   * Remembered latest `reputationBastions`/`reputationSyndicate`/`maxHull`
   * readings, mirrored straight from the observation on every fold (same
   * pattern as {@link loanState}) — kept on the belief state rather than read
   * from `obs.player` directly at feature time so an empty/fresh notebook
   * still degrades every memory-block feature to a sane `0` default.
   */
  lastReputationBastions: number;
  lastReputationSyndicate: number;
  lastMaxHull: number;
  /**
   * Folds since the last genuine galaxy-day boundary (reset alongside
   * {@link daysWithoutCreditGain}'s day-transition check). A profitable
   * same-system buy-low/sell-for-profit round trip is a `land`+`trade` cycle
   * that never simulates flight time (`land` teleports; only `move`/warp
   * actually advances the calendar), so a sufficiently good local margin can
   * otherwise be farmed forever without a single day ever passing. The base
   * ladder's price-discovery/buy-low tiers read this to back off once it's
   * run long enough, so play keeps progressing instead of camping one planet
   * pair — see `MemoryHeuristicPolicy`'s `daysStagnant`.
   */
  foldsSinceDayAdvance: number;
  /**
   * Internal: the scene observed on the immediately-previous fold, used only to
   * detect a STAR_MAP fold that's a genuine *continuation* (not a fresh arrival)
   * for {@link starMapStallFolds}.
   */
  lastScene: SceneType | null;
  /** Internal: the player's absolute fuel on the immediately-previous fold (see {@link starMapStallFolds}). */
  lastFuelSeen: number;
  /**
   * Consecutive folds spent continuously on STAR_MAP with fuel unchanged — the
   * signal that a chosen `warp` is silently failing to execute. The live engine
   * gates a jump on the *absolute* fuel cost of the specific target
   * (`StarMapScene.performWarpJump`), which can exceed what's left even when
   * {@link REFUEL_THRESHOLD}'s *fraction* gate says warping is fine (e.g. a
   * shrunk fuel tank after a downgrade) — that mismatch repeats the same failed
   * `warp` decision forever with zero feedback, stranding the agent on the map.
   * The base ladder's STAR_MAP tier reads this to give up on `warp` and fall
   * back to `move` (leave to flight, where the fuel-critical `land` tier can
   * still refuel) once it trips.
   */
  starMapStallFolds: number;
  /**
   * `engine.questManager.getCompletedQuestIds().length` as first observed this
   * run — `-1` until the first real fold. `canAcceptMoreDeliveryQuests`
   * (`engineQueries.ts`) subtracts this baseline before comparing against
   * `MAX_COMPLETED_DELIVERY_QUESTS`: that counter is a *lifetime, all-quest-types*
   * count on the engine, not scoped to DELIVERY quests this loop itself accepted.
   * Without a baseline, hooking the live autopilot into a save that already has
   * unrelated completed quests (story/tutorial/a human's own board pick) would
   * trip the lifetime cap immediately, silently refusing to ever take a DELIVERY
   * quest for the rest of the game.
   */
  completedQuestsBaseline: number;
  /**
   * Consecutive SPACE_FLIGHT folds that arrived straight from a STAR_MAP fold
   * with the system unchanged — i.e. the star map was opened to warp and the
   * ship is back in flight without ever leaving the system. A SUCCESSFUL warp
   * never produces this pattern: `PlayerAgent.completeWarp` ticks the jump to
   * completion inside the same `apply()` call, so the very next fold already
   * observes the NEW system. Only a rejected/failed warp (or a deliberate
   * `move:back` off the map) returns to SPACE_FLIGHT with the OLD system still
   * current. Resets to 0 on a genuine system change or a landing (both are
   * real forward progress). The base ladder reads this to tell "the explore
   * warp will actually work" apart from "it keeps getting rejected", so it can
   * rank the explore warp above the `earn`-land refuel fallback in the common
   * case while still falling back to `earn`-land once warping is visibly
   * stuck — see `MemoryHeuristicPolicy`'s SPACE_FLIGHT tier.
   */
  warpRejectFolds: number;
  /**
   * The planet whose consecutive *barren* stays {@link noopLandStreak} is
   * counting — the land-side sibling of
   * {@link consecutiveWarpsWithoutLanding} (live report 2026-07-29: the
   * `land "earn"` fallback re-landed on the same already-priced, quest-less
   * planet forever whenever every warp-side loop-breaker was gated). A stay is
   * barren when it learned no new prices, moved no cargo, and changed no quest
   * state by the time the take-off fold evaluates it. Reset (with the streak)
   * by a productive stay or a system change.
   */
  noopLandPlanetId: string | null;
  /** Consecutive barren stays on {@link noopLandPlanetId} — see its doc. */
  noopLandStreak: number;
  /**
   * Internal: whether the *current* stay has already proven productive
   * (fresh prices learned on the landing fold, or cargo/quest deltas on a
   * mid-stay fold). Folded into the streak on the take-off fold, which also
   * checks that fold's own deltas (the live trade round-trip surfaces its
   * cargo delta only after leaving the planet).
   */
  landedStayProductive: boolean;
  /** Internal: `obs.quests.length` on the immediately-previous fold (quest-delta signal for the stay tracker). */
  lastQuestCount: number;
}

/** Bound on {@link AgentMemory.recentSystemIds} — see its field doc. */
export const RECENT_SYSTEM_IDS_MAX = 4;

/**
 * The {@link AgentMemory.completedQuestsBaseline} an `observe()` call should use
 * — the memory's own captured baseline once known, else "no completions yet
 * this session" (the engine's current lifetime count), so the very first
 * observation of a run (before the first fold captures the real baseline) never
 * reads a pre-existing save's completed quests as this session's own. Callers
 * that drive a live/headless session (not a one-off diagnostic) should resolve
 * this once per step and pass it into {@link observe} — see `observe`'s own
 * `completedQuestsBaseline` parameter doc for why.
 */
export function questBaselineForObserve(
  mem: Pick<AgentMemory, "completedQuestsBaseline">,
  engine: GameEngine,
): number {
  return mem.completedQuestsBaseline >= 0
    ? mem.completedQuestsBaseline
    : engine.questManager.getCompletedQuestIds().length;
}

/**
 * The compound "nothing good to do" state: hull critically low, broke, no quest
 * to fall back on, a hostile present, and an outstanding loan on top. Pure —
 * evaluated fresh every fold/decide rather than only read from the sticky flag,
 * so it is testable in isolation without pre-populating {@link AgentMemory}.
 */
export function detectDeadlock(obs: Observation, mem: AgentMemory): boolean {
  const hull = obs.player?.hullFraction ?? 1;
  const credits = obs.player?.credits ?? 0;
  return (
    hull <= DEADLOCK_HULL_FRACTION &&
    credits < DEADLOCK_MIN_CREDITS &&
    obs.quests.length === 0 &&
    obs.hostiles.length > 0 &&
    mem.loanState !== undefined
  );
}

/** A fresh, empty notebook — call once per run (a human starting over). */
export function createMemory(): AgentMemory {
  return {
    priceBook: new Map(),
    inventoryLots: [],
    threatMap: new Map(),
    planetSystems: new Map(),
    knownOffers: [],
    lastCargo: new Map(),
    step: 0,
    visitedSystemIds: new Set(),
    lastSystemId: null,
    lastCurrentPlanetId: null,
    previousSystemId: null,
    recentSystemIds: [],
    frontCycleStreak: 0,
    consecutiveWarpsWithoutLanding: 0,
    loanState: undefined,
    deadlockDetected: false,
    activeQuestDelivery: [],
    creditYesterday: 0,
    daysWithoutCreditGain: 0,
    overmindDaysSeen: 0,
    lastDaySeen: -1,
    lastReputationBastions: 0,
    lastReputationSyndicate: 0,
    lastMaxHull: 0,
    foldsSinceDayAdvance: 0,
    lastScene: null,
    lastFuelSeen: 0,
    starMapStallFolds: 0,
    completedQuestsBaseline: -1,
    warpRejectFolds: 0,
    noopLandPlanetId: null,
    noopLandStreak: 0,
    landedStayProductive: false,
    lastQuestCount: 0,
  };
}

/** Deep-ish clone of the price book so {@link updateMemory} never mutates its input. */
function clonePriceBook(
  pb: Map<string, Map<ResourceType, PriceRecord>>,
): Map<string, Map<ResourceType, PriceRecord>> {
  const out = new Map<string, Map<ResourceType, PriceRecord>>();
  for (const [planetId, goods] of pb) out.set(planetId, new Map(goods));
  return out;
}

/**
 * Drain `qty` units of `good` from the lots, oldest first (FIFO), returning a new
 * lot list. A whole lot fully consumed is dropped; a partially-consumed lot keeps
 * its `buyPrice` on the remainder. Lots of other goods pass through untouched.
 */
function consumeLots(
  lots: InventoryLot[],
  good: ResourceType,
  qty: number,
): InventoryLot[] {
  let remaining = qty;
  const out: InventoryLot[] = [];
  for (const lot of lots) {
    if (lot.good !== good || remaining <= 0) {
      out.push(lot);
      continue;
    }
    if (lot.qty <= remaining) {
      remaining -= lot.qty; // whole lot consumed — drop it
    } else {
      out.push({ ...lot, qty: lot.qty - remaining });
      remaining = 0;
    }
  }
  return out;
}

/**
 * Fold one egocentric {@link Observation} into the belief state, returning a
 * **new** {@link AgentMemory} (the input is never mutated). It records:
 *
 *  - the **landed planet's market** into the price book (the only visible prices),
 *    bumping `seenAt` on a re-visit;
 *  - a **buy** — detected as cargo increasing while landed — as an inventory lot at
 *    that planet's observed buy price (cargo gained with no visible price, e.g.
 *    loot, is recorded at `buyPrice 0`); a **sell** drains lots FIFO;
 *  - the **worst hostile presence** seen in the current system into the threat map.
 *
 * It stores nothing the observation did not contain: no prices in flight, no
 * unvisited planet, no unseen system.
 */
export function updateMemory(mem: AgentMemory, obs: Observation): AgentMemory {
  const step = mem.step + 1;
  const priceBook = clonePriceBook(mem.priceBook);
  const threatMap = new Map(mem.threatMap);
  const planetSystems = new Map(mem.planetSystems);
  const knownOffers = mem.knownOffers.map((o) => ({ ...o }));
  let inventoryLots = mem.inventoryLots.map((l) => ({ ...l }));

  // No player (pre-game menus) ⇒ nothing perceivable; just advance the step.
  if (!obs.hasPlayer || !obs.player) {
    return {
      priceBook,
      inventoryLots,
      threatMap,
      planetSystems,
      knownOffers,
      lastCargo: mem.lastCargo,
      step,
      visitedSystemIds: new Set(mem.visitedSystemIds),
      lastSystemId: mem.lastSystemId,
      lastCurrentPlanetId: mem.lastCurrentPlanetId,
      previousSystemId: mem.previousSystemId,
      recentSystemIds: [...mem.recentSystemIds],
      frontCycleStreak: mem.frontCycleStreak,
      consecutiveWarpsWithoutLanding: mem.consecutiveWarpsWithoutLanding,
      loanState: mem.loanState,
      deadlockDetected: mem.deadlockDetected,
      activeQuestDelivery: mem.activeQuestDelivery.map((d) => ({ ...d })),
      creditYesterday: mem.creditYesterday,
      daysWithoutCreditGain: mem.daysWithoutCreditGain,
      overmindDaysSeen: mem.overmindDaysSeen,
      lastDaySeen: mem.lastDaySeen,
      lastReputationBastions: mem.lastReputationBastions,
      lastReputationSyndicate: mem.lastReputationSyndicate,
      lastMaxHull: mem.lastMaxHull,
      foldsSinceDayAdvance: mem.foldsSinceDayAdvance,
      lastScene: mem.lastScene,
      lastFuelSeen: mem.lastFuelSeen,
      starMapStallFolds: mem.starMapStallFolds,
      completedQuestsBaseline: mem.completedQuestsBaseline,
      warpRejectFolds: mem.warpRejectFolds,
      noopLandPlanetId: mem.noopLandPlanetId,
      noopLandStreak: mem.noopLandStreak,
      landedStayProductive: mem.landedStayProductive,
      lastQuestCount: mem.lastQuestCount,
    };
  }

  // 1) Price book — the landed planet's market is the only price the agent can see.
  if (obs.currentPlanet) {
    const goods =
      priceBook.get(obs.currentPlanet.id) ??
      new Map<ResourceType, PriceRecord>();
    for (const g of obs.currentPlanet.market) {
      goods.set(g.resource, { buy: g.buy, sell: g.sell, seenAt: step });
    }
    priceBook.set(obs.currentPlanet.id, goods);
  }

  // 2) Threat map — remember the worst hostile presence ever seen in this system.
  if (obs.system && obs.hostiles.length > 0) {
    const prev = threatMap.get(obs.system.id) ?? 0;
    threatMap.set(obs.system.id, Math.max(prev, obs.hostiles.length));
  }

  // 2.5) Planet→system gazetteer — every planet of the CURRENT system (the
  // flight scene shows them all; no landing required). Lets the ladder route
  // back to a remembered planet's system later (`go-restock`).
  if (obs.system) {
    for (const p of obs.system.planets) planetSystems.set(p.id, obs.system.id);
  }

  // 3) Inventory lots — diff held cargo against last step to detect buys/sells.
  const cargoNow = new Map<ResourceType, number>();
  for (const c of obs.player.cargo) cargoNow.set(c.type, c.amount);

  const seenGoods = new Set<ResourceType>([
    ...mem.lastCargo.keys(),
    ...cargoNow.keys(),
  ]);
  for (const good of seenGoods) {
    const before = mem.lastCargo.get(good) ?? 0;
    const after = cargoNow.get(good) ?? 0;
    if (after > before) {
      // A buy — record a lot at the landed planet's observed buy price. When not
      // currently landed, fall back to the planet observed one fold ago (the
      // live open-trade round-trip: the buy happens between this fold and the
      // last, and the scene has already left PLANET by the time the delta is
      // visible) before defaulting to 0 (a genuine unpriced gain, e.g. loot).
      const buyPrice =
        obs.currentPlanet?.market.find((m) => m.resource === good)?.buy ??
        (mem.lastCurrentPlanetId != null
          ? priceBook.get(mem.lastCurrentPlanetId)?.get(good)?.buy
          : undefined) ??
        0;
      inventoryLots.push({ good, qty: after - before, buyPrice });
    } else if (after < before) {
      // A sell / consume — drain the oldest lots of this good first.
      inventoryLots = consumeLots(inventoryLots, good, before - after);
    }
  }

  // 4) Visited systems — the current system, accumulated across the run.
  const visitedSystemIds = new Set(mem.visitedSystemIds);
  if (obs.system) visitedSystemIds.add(obs.system.id);

  // 4.5) Consecutive-warp cadence — a landing (anywhere) always resets the
  // tally; observing a different system while still in flight (no planet
  // under the ship) means a warp completed since the last landing, so bump it.
  let consecutiveWarpsWithoutLanding = mem.consecutiveWarpsWithoutLanding;
  const systemChanged =
    obs.system !== null &&
    mem.lastSystemId !== null &&
    obs.system.id !== mem.lastSystemId;
  if (obs.currentPlanet) {
    consecutiveWarpsWithoutLanding = 0;
  } else if (systemChanged) {
    consecutiveWarpsWithoutLanding += 1;
  }
  const lastSystemId = obs.system?.id ?? mem.lastSystemId;
  // Only advances on a genuine system change (`systemChanged`) — several folds
  // can happen while the system is unchanged (e.g. SPACE_FLIGHT → STAR_MAP is
  // its own fold before the jump fires), and naively mirroring `lastSystemId`
  // on every fold would overwrite "where we came from" with the current
  // system after just one such no-op fold, well before the STAR_MAP-scene
  // decision that actually consumes it for the anti-ping-pong tie-break.
  const previousSystemId = systemChanged
    ? mem.lastSystemId
    : mem.previousSystemId;
  // 4.6) Recent-system history + front-cycle streak (F1, three-year-campaign
  // Task 16b): on a genuine hop, push the just-departed system onto a bounded
  // rolling history (most-recent-first) — see `AgentMemory.recentSystemIds`'s
  // field doc for why this outlives the single-step `previousSystemId`.
  // `frontCycleStreak` counts consecutive hops that land back on a system
  // already in that PRE-update history (a revisit within the window); any
  // other hop (fresh territory) resets it, and a non-hop fold leaves both
  // untouched.
  const recentSystemIds =
    systemChanged && mem.lastSystemId !== null
      ? [mem.lastSystemId, ...mem.recentSystemIds].slice(
          0,
          RECENT_SYSTEM_IDS_MAX,
        )
      : mem.recentSystemIds;
  const frontCycleStreak = !systemChanged
    ? mem.frontCycleStreak
    : obs.system && mem.recentSystemIds.includes(obs.system.id)
      ? mem.frontCycleStreak + 1
      : 0;

  // 4.7) No-op-land streak — the land-side sibling of the consecutive-warp
  // cadence (live report 2026-07-29, «зацикливание посадка-взлёт»). A stay is
  // productive if it learned new prices (the landing fold saw an un-priced
  // planet), moved cargo, or changed quest state — the latter two checked on
  // every fold of the stay AND on the take-off fold itself, because the live
  // trade round-trip only surfaces its cargo delta after leaving the planet.
  // Barren stays on the same planet accumulate; `MemoryHeuristicPolicy`'s
  // earn-land fallback stands down once the streak trips its cap.
  let cargoChangedThisFold = false;
  for (const good of seenGoods) {
    if ((mem.lastCargo.get(good) ?? 0) !== (cargoNow.get(good) ?? 0)) {
      cargoChangedThisFold = true;
      break;
    }
  }
  const questCountChanged = obs.quests.length !== mem.lastQuestCount;
  const freshlyLanded =
    obs.currentPlanet !== null &&
    mem.lastCurrentPlanetId !== obs.currentPlanet.id;
  const justTookOff =
    obs.currentPlanet === null && mem.lastCurrentPlanetId !== null;
  let landedStayProductive = mem.landedStayProductive;
  let noopLandPlanetId = mem.noopLandPlanetId;
  let noopLandStreak = mem.noopLandStreak;
  if (freshlyLanded && obs.currentPlanet) {
    // NOTE: `mem.priceBook` (pre-fold) — section 1 above has already folded
    // this landing's market into the local `priceBook` copy.
    landedStayProductive =
      !mem.priceBook.has(obs.currentPlanet.id) || questCountChanged;
  } else if (obs.currentPlanet && (cargoChangedThisFold || questCountChanged)) {
    landedStayProductive = true;
  }
  if (justTookOff) {
    const stayedProductive =
      landedStayProductive || cargoChangedThisFold || questCountChanged;
    if (stayedProductive) {
      noopLandPlanetId = null;
      noopLandStreak = 0;
    } else if (noopLandPlanetId === mem.lastCurrentPlanetId) {
      noopLandStreak += 1;
    } else {
      noopLandPlanetId = mem.lastCurrentPlanetId;
      noopLandStreak = 1;
    }
    landedStayProductive = false;
  }
  if (systemChanged) {
    // A fresh system's planets are fair game — the streak is per-planet and
    // planets are system-local.
    noopLandPlanetId = null;
    noopLandStreak = 0;
  }

  // 5) Loan state — only what the observation says right now; no loan ⇒ absent.
  const loanState = obs.activeLoans
    ? {
        balance: obs.loanBalance ?? 0,
        missedPayments: obs.loanMissedPayments ?? 0,
      }
    : undefined;

  // 6) Active quest deliveries — carried quests with a known delivery system,
  // mirrored straight from the observation (not accumulated: a completed/dropped
  // quest simply falls out on the next fold).
  const activeQuestDelivery: ActiveQuestDelivery[] = obs.quests
    .filter(
      (q): q is typeof q & { targetSystemId: string } => !!q.targetSystemId,
    )
    .map((q) => ({ questId: q.id, targetSystemId: q.targetSystemId }));

  // 7) Day-boundary bookkeeping — `obs.gameDay` is the only clock the pure
  // belief state can see. On a genuine day transition (day advanced beyond
  // the last one folded), roll the stagnation counter against the credits
  // banked "yesterday" and tally an Overmind-pressure day; same-day / unknown
  // (`gameDay` absent) folds leave all four untouched.
  let creditYesterday = mem.creditYesterday;
  let daysWithoutCreditGain = mem.daysWithoutCreditGain;
  let overmindDaysSeen = mem.overmindDaysSeen;
  let lastDaySeen = mem.lastDaySeen;
  let foldsSinceDayAdvance = mem.foldsSinceDayAdvance + 1;
  if (obs.gameDay !== undefined && obs.gameDay > mem.lastDaySeen) {
    daysWithoutCreditGain =
      obs.player.credits > mem.creditYesterday
        ? 0
        : mem.daysWithoutCreditGain + 1;
    creditYesterday = obs.player.credits;
    if ((obs.overmindShare ?? 0) > 0) overmindDaysSeen += 1;
    lastDaySeen = obs.gameDay;
    foldsSinceDayAdvance = 0;
  }

  // 7.5) STAR_MAP warp-stall — a continuation fold (previous fold was ALSO
  // STAR_MAP, not a fresh arrival) with fuel unchanged means whatever action
  // ran since the last fold made no progress; only genuinely repeated
  // no-progress folds count; a fresh arrival or a fuel change resets to 0.
  const starMapStallFolds =
    obs.scene === SceneType.STAR_MAP &&
    mem.lastScene === SceneType.STAR_MAP &&
    obs.player.fuel === mem.lastFuelSeen
      ? mem.starMapStallFolds + 1
      : 0;

  // 7.6) Completed-quest baseline — captured once, on the first real fold, so
  // `canAcceptMoreDeliveryQuests` can measure *this run's* DELIVERY completions
  // instead of the engine's lifetime-all-types counter (see the field doc).
  const completedQuestsBaseline =
    mem.completedQuestsBaseline >= 0
      ? mem.completedQuestsBaseline
      : (obs.questsCompleted ?? 0);

  // 7.7) Warp-reject cadence — see the field doc on `warpRejectFolds`. A
  // landing or a genuine system change is real progress and always resets it;
  // otherwise a SPACE_FLIGHT fold arriving straight from STAR_MAP with the
  // system unchanged means the star-map round trip did NOT complete a jump
  // (rejected warp, or a deliberate non-warp `back`), so it counts toward the
  // streak. Any other fold (e.g. consecutive SPACE_FLIGHT folds mid-`move`)
  // leaves it untouched — it's a streak of failed *warp attempts*, not a
  // per-fold decay.
  const returnedFromStarMapSameSystem =
    obs.scene === SceneType.SPACE_FLIGHT &&
    mem.lastScene === SceneType.STAR_MAP &&
    !systemChanged;
  const warpRejectFolds =
    obs.currentPlanet || systemChanged
      ? 0
      : returnedFromStarMapSameSystem
        ? mem.warpRejectFolds + 1
        : mem.warpRejectFolds;

  const next: AgentMemory = {
    priceBook,
    inventoryLots,
    threatMap,
    planetSystems,
    knownOffers,
    lastCargo: cargoNow,
    step,
    visitedSystemIds,
    lastSystemId,
    lastCurrentPlanetId: obs.currentPlanet?.id ?? null,
    previousSystemId,
    recentSystemIds,
    frontCycleStreak,
    consecutiveWarpsWithoutLanding,
    loanState,
    deadlockDetected: mem.deadlockDetected,
    activeQuestDelivery,
    creditYesterday,
    daysWithoutCreditGain,
    overmindDaysSeen,
    lastDaySeen,
    lastReputationBastions: obs.player.reputationBastions ?? 0,
    lastReputationSyndicate: obs.player.reputationSyndicate ?? 0,
    lastMaxHull: obs.player.maxHull,
    foldsSinceDayAdvance,
    lastScene: obs.scene,
    lastFuelSeen: obs.player.fuel,
    starMapStallFolds,
    completedQuestsBaseline,
    warpRejectFolds,
    noopLandPlanetId,
    noopLandStreak,
    landedStayProductive,
    lastQuestCount: obs.quests.length,
  };

  // 8) Deadlock — sticky once true; logged exactly once per run at the transition.
  if (!mem.deadlockDetected && detectDeadlock(obs, next)) {
    logger.warn(
      `[DEADLOCK] step=${step} credits=${obs.player.credits} hull=${obs.player.hullFraction} system=${obs.system?.id ?? "?"}`,
    );
    next.deadlockDetected = true;
  }

  return next;
}
