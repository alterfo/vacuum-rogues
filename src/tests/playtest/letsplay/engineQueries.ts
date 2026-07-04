/**
 * Letsplay engine — shared live-engine query helpers (dev-only).
 *
 * Small, pure projections off the live {@link GameEngine} that both action
 * appliers need: the headless {@link PlayerAgent} (driving the harness) and the
 * live {@link createLiveSceneController} (driving the rendered scene). Keeping
 * them here is the single source of truth, so a fix to how the agent resolves its
 * current system / landed planet / board quests reaches *both* loops at once.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module (enforced
 * by `letsplayDevOnly.test.ts`).
 */
import type { GameEngine } from "@/systems/GameEngine";
import type { StarSystem } from "@/domain/StarSystem";
import type { Planet } from "@/domain/Planet";
import { QuestType } from "@/types";
import type { ResourceType } from "@/types";
import { TradeSystem } from "@/systems/TradeSystem";
import {
  cargoCapacityOf,
  applyLoadoutHullToShip,
} from "@/systems/equipment/GearBridge";
import { hullStatus } from "@/systems/equipment/hullStatus";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";

/** Resolve the player's current star system from the live engine, if any. */
export function currentSystem(engine: GameEngine): StarSystem | null {
  const player = engine.player;
  const galaxy = engine.galaxy;
  if (!player || !galaxy) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

/** The planet the player is presently landed on, if resolvable. */
export function landedPlanet(engine: GameEngine): Planet | null {
  const sys = currentSystem(engine);
  const landedId = engine.player?.landedPlanetId;
  if (!sys || !landedId) return null;
  return sys.planets.find((p) => p.id === landedId) ?? null;
}

/**
 * The systems actually warpable-to from `currentSystemId` in ONE real jump —
 * matching what `StarMapScene.performWarpJumpTo` itself permits
 * (`hasPathFromPlayer || hasPathToPlayer`), NOT just `system.connections`.
 * `GalaxySimulator`'s nearest-neighbour pass (`system.connections.push(...)`)
 * adds each edge on only ONE system's side — A can list B as a nearest
 * neighbour without B listing A back — but the engine still allows the jump
 * from either end. Every warp-target candidate pool in this module must use
 * this instead of `system.connections` directly, or a real, immediately
 * reachable neighbour whose only listed edge points the other way silently
 * never becomes a pickable target (this hid known-adjacent DELIVERY-quest
 * destinations from the routing bias below entirely).
 */
export function reachableNeighbors(
  systems: readonly {
    id: string;
    connections: readonly { toSystemId: string }[];
  }[],
  currentSystemId: string | null,
): { toSystemId: string }[] {
  if (currentSystemId == null) return [];
  const forward =
    systems.find((s) => s.id === currentSystemId)?.connections ?? [];
  const ids = new Set(forward.map((c) => c.toSystemId));
  for (const s of systems) {
    if (s.id === currentSystemId) continue;
    if (s.connections.some((c) => c.toSystemId === currentSystemId)) {
      ids.add(s.id);
    }
  }
  return [...ids].map((toSystemId) => ({ toSystemId }));
}

/**
 * Pick a `warp` destination from `connections` — "direction of the unknown"
 * (CJM-G explorer's spec, but applied to every warp since target selection is
 * centralized here rather than per-CJM): prefer a system not yet in
 * `visited`, then fall back to anything other than `lastSystemId` (avoids
 * ping-ponging between two adjacent systems), then the first connection.
 * `avoid` (optional — Overmind-held systems, Task 3) is stripped from the
 * candidate pool first when doing so still leaves somewhere to go; when every
 * connection is avoided (a front-encircled system), it falls back to the full
 * pool rather than returning `undefined` — jumping into the front is still
 * better than not jumping at all. Pure — no engine access — so it's cheaply
 * unit-testable against a mock connections list.
 *
 * `prefer` (optional — a carried DELIVERY quest's target system, Task 2) wins
 * outright when it's a direct neighbour surviving the `avoid` filtering.
 * Otherwise, when `hopsToPrefer` (see {@link systemHopDistances}) is given,
 * the pool candidate with the smallest hop-distance to `prefer` wins instead
 * of the generic "explore the unknown" heuristic — greedily walking the warp
 * graph toward a KNOWN destination across more than one jump, since every
 * other warp reason here has no specific place to be, while a delivery does.
 * Both preferences are still filtered by `avoid` first, so this never trades
 * away the Overmind-avoidance safety this function already provides — it
 * only breaks ties among the SAME candidate pool every other reason uses,
 * toward a destination that's actually useful instead of an arbitrary
 * unvisited one. Pure — no engine access — so it's cheaply unit-testable
 * against a mock connections list.
 */
export function pickWarpTarget(
  connections: readonly { toSystemId: string }[],
  lastSystemId: string | null,
  visited: ReadonlySet<string>,
  avoid?: ReadonlySet<string>,
  prefer?: string | null,
  hopsToPrefer?: ReadonlyMap<string, number>,
): string | undefined {
  const pool =
    avoid && avoid.size > 0
      ? (() => {
          const filtered = connections.filter((c) => !avoid.has(c.toSystemId));
          return filtered.length > 0 ? filtered : connections;
        })()
      : connections;
  if (prefer != null && pool.some((c) => c.toSystemId === prefer)) {
    return prefer;
  }
  if (prefer != null && hopsToPrefer && hopsToPrefer.size > 0) {
    const reachable = pool.filter((c) => hopsToPrefer.has(c.toSystemId));
    if (reachable.length > 0) {
      return reachable.reduce((closest, c) =>
        (hopsToPrefer.get(c.toSystemId) ?? Infinity) <
        (hopsToPrefer.get(closest.toSystemId) ?? Infinity)
          ? c
          : closest,
      ).toSystemId;
    }
  }
  return (
    pool.find((c) => !visited.has(c.toSystemId)) ??
    pool.find((c) => c.toSystemId !== lastSystemId) ??
    pool[0]
  )?.toSystemId;
}

/**
 * BFS hop-distance from every system reachable from `targetSystemId` to that
 * target, over the warp graph treated as UNDIRECTED — connections are
 * recorded one-way per system but warping is bidirectional (same convention
 * as `Galaxy.revealSystemsWithinHops`/`frontierSystems`). Feeds
 * {@link pickWarpTarget}'s `hopsToPrefer` so a quest-routing bias can walk
 * toward a target more than one jump away without a full pathfinder at every
 * call site. Empty map when `targetSystemId` isn't a known system.
 */
export function systemHopDistances(
  systems: readonly {
    id: string;
    connections: readonly { toSystemId: string }[];
  }[],
  targetSystemId: string,
): ReadonlyMap<string, number> {
  const knownIds = new Set(systems.map((s) => s.id));
  const dist = new Map<string, number>();
  if (!knownIds.has(targetSystemId)) return dist;
  const adjacent = new Map<string, Set<string>>();
  for (const s of systems) adjacent.set(s.id, new Set());
  for (const s of systems) {
    for (const c of s.connections) {
      if (!knownIds.has(c.toSystemId)) continue;
      adjacent.get(s.id)?.add(c.toSystemId);
      adjacent.get(c.toSystemId)?.add(s.id);
    }
  }
  dist.set(targetSystemId, 0);
  const queue = [targetSystemId];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(cur) ?? 0;
    for (const n of adjacent.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * The target system of the (at most one, {@link MAX_ACTIVE_DELIVERY_QUESTS})
 * active DELIVERY quest, when it differs from `currentSystemId` — the value
 * to pass as {@link pickWarpTarget}'s `prefer` so ordinary exploration warps
 * are biased toward actually finishing the quest instead of picking an
 * arbitrary unvisited neighbour. `null` with no active quest, a quest already
 * targeting the current system, or a non-DELIVERY quest (this loop never
 * takes any other type, see `isTakeableBoardQuest`, but stays defensive).
 */
export function questRoutingPreference(
  quests: readonly {
    type: QuestType;
    targetSystemId: string | null;
  }[],
  currentSystemId: string | null,
): string | null {
  const quest = quests.find(
    (q) =>
      q.type === QuestType.DELIVERY &&
      q.targetSystemId != null &&
      q.targetSystemId !== currentSystemId,
  );
  return quest?.targetSystemId ?? null;
}

/**
 * A board quest this headless/live autopilot loop can actually act on: DELIVERY
 * only. TEXT_ADVENTURE, BOUNTY, DIPLOMACY, ESCORT, and EXPLORATION all need a
 * dedicated interaction this loop's decision ladder has no policy for (branching
 * dialogue, hunting a specific NPC, escort behavior, ...) — taking one would
 * just sit active forever with no path to completion, and since it's never
 * resolved it never leaves the board, so counting it as "available" would make
 * the ladder's take-quest tier fire forever with nothing left to actually take.
 * DELIVERY is the one type this loop can both progress (buy the collect-item
 * need, see `deliveryCargoNeed`) and complete (route to the target, see
 * `deliveryReadyToTurnIn` and `PlanetScene.checkDeliveryQuestCompletion`).
 */
function isTakeableBoardQuest(offered: {
  template: { type: QuestType };
}): boolean {
  return offered.template.type === QuestType.DELIVERY;
}

/**
 * At most this many DELIVERY quests active at once. Stacking several
 * multi-unit cargo contracts (each needing 6-14 units bought+carried across a
 * warp to a different system) blows every deadline at once — each failure
 * costs reputation, and reputation collapsing far enough makes hostiles
 * attack on sight, chaining into a death spiral this ladder's combat
 * survive-block can't out-flee (a fresh attacker every warp jump). One
 * contract at a time lets the trade loop dedicate itself to finishing it
 * before taking on the next.
 */
const MAX_ACTIVE_DELIVERY_QUESTS = 1;

/**
 * Lifetime cap (per game, not per landing) on *completed* DELIVERY quests
 * before the ladder stops taking on new ones altogether. Each quest's
 * buy→warp→deliver cycle costs several extra warps beyond the ladder's
 * ordinary trading — and only `move`/`warp` advance the galaxy calendar, so
 * every extra quest chases the Overmind spread further along within the same
 * step budget (real-engine regression: endless back-to-back quest churn for
 * an entire 200-step session pushed Overmind share to ~92% — well past the
 * 0.85 "galaxy lost" line in `balance.ts` — where nearly every remaining
 * system is an Overmind garrison, and a fresh quest sent a full-hull ship
 * straight into one). That regression is now guarded directly by
 * `QUEST_ACCEPT_OVERMIND_SHARE_CEILING` (`MemoryHeuristicPolicy.ts`) refusing
 * to take a NEW quest once the galaxy is 60%+ Overmind-held — a check against
 * the actual galaxy state, not a proxy — so this cap only needs to bound
 * *ordinary*, safe-galaxy quest churn rather than carry the whole risk on its
 * own; a *failed* attempt doesn't count against it (it never reduced the
 * galaxy's risk, so it shouldn't spend one of the ladder's shots).
 */
const MAX_COMPLETED_DELIVERY_QUESTS = 5;

/** Active DELIVERY quests right now, against {@link MAX_ACTIVE_DELIVERY_QUESTS}. */
function activeDeliveryQuestCount(engine: GameEngine): number {
  return engine.questManager
    .getActiveQuests()
    .filter((q) => q.type === QuestType.DELIVERY).length;
}

/**
 * Whether the ladder may take on another DELIVERY quest right now: under the
 * concurrent cap AND under the lifetime completed-quest cap (see
 * {@link MAX_ACTIVE_DELIVERY_QUESTS}/{@link MAX_COMPLETED_DELIVERY_QUESTS}).
 * Only DELIVERY quests are ever accepted (see `isTakeableBoardQuest`), so
 * every completed quest in this closed loop is a DELIVERY completion —
 * `getCompletedQuestIds()` is a safe lifetime-completion proxy without
 * needing separate bookkeeping.
 */
function canAcceptMoreDeliveryQuests(engine: GameEngine): boolean {
  return (
    activeDeliveryQuestCount(engine) < MAX_ACTIVE_DELIVERY_QUESTS &&
    engine.questManager.getCompletedQuestIds().length <
      MAX_COMPLETED_DELIVERY_QUESTS
  );
}

/**
 * Count of the landed planet's job-board offers this loop can actually take
 * right now — the same filter + caps {@link acceptBoardQuests} applies — via
 * the real `getQuestBoard` seam `PlanetScene.openJobBoard` uses (EPIC-008),
 * NOT `planet.availableQuests`, a static generation-time field that is always
 * `[]` (the real board is generated on demand). `0` once either cap is hit:
 * without this, the ladder's take-quest tier would see a nonzero board
 * forever while accepting nothing — the same permanent-retry stall
 * `isTakeableBoardQuest` was added to avoid.
 */
export function takeableBoardQuestCount(
  engine: GameEngine,
  planetId: string,
): number {
  if (!canAcceptMoreDeliveryQuests(engine)) return 0;
  return engine.getQuestBoard(planetId).filter(isTakeableBoardQuest).length;
}

/**
 * Accept contracts the landed planet's job board currently offers that this
 * loop can act on (see {@link isTakeableBoardQuest}), up to
 * {@link MAX_ACTIVE_DELIVERY_QUESTS} at once and never past the
 * {@link MAX_COMPLETED_DELIVERY_QUESTS} lifetime cap, via the same real
 * `getQuestBoard`/`acceptBoardQuest` seam `PlanetScene.openJobBoard`/
 * `acceptJob` use (EPIC-008).
 */
export function acceptBoardQuests(engine: GameEngine): void {
  const planet = landedPlanet(engine);
  if (!planet) return;
  let activeDeliveryCount = activeDeliveryQuestCount(engine);
  for (const offered of engine.getQuestBoard(planet.id)) {
    if (
      activeDeliveryCount >= MAX_ACTIVE_DELIVERY_QUESTS ||
      !canAcceptMoreDeliveryQuests(engine)
    )
      break;
    if (!isTakeableBoardQuest(offered)) continue;
    if (engine.acceptBoardQuest(offered, planet.id)) activeDeliveryCount++;
  }
}

/**
 * Sell every unit of cargo `player` holds at `planet`'s market (clones the list
 * so mutations don't affect iteration) via the real {@link TradeSystem} seam,
 * except any resource type in `protect` — cargo already committed to an active
 * DELIVERY quest's COLLECT_ITEM need, which a blind sell-everything would
 * otherwise sell off and immediately re-buy (at this planet's own spread) the
 * next time the ladder buys more of it elsewhere, bleeding credits every visit
 * without ever finishing the collection. Shared by {@link executeTradeOnPlanet}
 * and {@link executeSellAll}.
 */
function sellAllCargo(
  ts: TradeSystem,
  engine: GameEngine,
  planet: Planet,
  protect: ReadonlySet<ResourceType> = new Set(),
): void {
  const player = engine.player;
  if (!player) return;
  const capacity = cargoCapacityOf(engine.playerLoadout);
  for (const cargo of [...player.inventory.resources]) {
    if (cargo.amount <= 0 || protect.has(cargo.type)) continue;
    ts.executeTrade(
      player,
      planet,
      cargo.type,
      cargo.amount,
      false,
      capacity,
      engine.bank,
    );
  }
}

/**
 * Sell every unit of cargo the player holds at `planet`'s market — the explicit
 * sell-only counterpart to {@link executeTradeOnPlanet} (which also buys), backing
 * the `sell-cargo` action so "sell what I'm carrying" never accidentally re-buys.
 */
export function executeSellAll(engine: GameEngine, planet: Planet): void {
  sellAllCargo(new TradeSystem(), engine, planet);
}

/**
 * Execute simple market trades at `planet` via the real {@link TradeSystem} seam:
 * sell all held cargo at any price, then spend available credits on the cheapest
 * available good. Uses the same `executeTrade` path the {@link TradeScene} UI
 * uses — credits and cargo change, the bank ledger is posted. Dev-only helper.
 */
export function executeTradeOnPlanet(engine: GameEngine, planet: Planet): void {
  executeMemoryAwareTrade(engine, planet, null);
}

/**
 * Never let a single buy spend more than this fraction leaves in reserve —
 * a bulk buy of a known-profitable good still leaves a credit cushion rather
 * than emptying the wallet. A buy costing more than the reserve allows is not
 * blocked outright (that would forbid ever affording the *one* unit of a
 * genuinely known-profitable good), only the quantity is capped by it.
 */
const TRADE_CREDIT_RESERVE_FRACTION = 0.3;

/**
 * Memory-aware trade executor: sell all held cargo, then — only when a
 * `preferredGood` is supplied and stocked here — buy it, capped so the buy
 * never spends the whole wallet (see {@link TRADE_CREDIT_RESERVE_FRACTION}).
 *
 * `preferredGood == null` means "no known cross-planet margin" and is
 * deliberately **sell-only**: blindly buying the locally cheapest good
 * regardless of whether (or where) it can be resold is the full-wallet
 * speculation that used to drain the agent's credits into unsellable cargo
 * (see docs/plans/20260703-autopilot-goal-trading-and-npc-brains.md) — removed
 * outright rather than capped. Price discovery doesn't need a buy either: the
 * observation/memory fold already learns a landed planet's market for free.
 *
 * The {@link PlayerAgent} hands in the best cross-planet margin good known
 * from its belief state, so the agent buys for a route it already has a sell
 * destination for. Both paths use the same `executeTrade` seam as
 * {@link TradeScene}.
 *
 * `maxQty` additionally caps the buy — used for a DELIVERY quest's cargo need
 * (`deliveryCargoNeed`), where the useful quantity is exactly the remaining
 * shortfall, not "as much as the reserve fraction allows".
 *
 * `protectGoods` excludes those resource types from the sell-all-cargo step —
 * see {@link sellAllCargo}.
 */
export function executeMemoryAwareTrade(
  engine: GameEngine,
  planet: Planet,
  preferredGood: ResourceType | null,
  maxQty?: number,
  protectGoods?: ReadonlySet<ResourceType>,
): void {
  const player = engine.player;
  if (!player) return;
  const ts = new TradeSystem();
  const capacity = cargoCapacityOf(engine.playerLoadout);

  sellAllCargo(ts, engine, planet, protectGoods);

  if (preferredGood === null) return;

  const resources = planet.market?.availableResources ?? [];
  if (!resources.includes(preferredGood)) return;
  const holdUsed = player.inventory.resources.reduce((s, r) => s + r.amount, 0);
  const holdFree = Math.max(0, capacity - holdUsed);
  if (holdFree === 0) return;

  const price = ts.getBuyPrice(planet, preferredGood, player);
  if (price <= 0 || player.credits < price) return;
  const reserveSpend = Math.floor(
    player.credits * (1 - TRADE_CREDIT_RESERVE_FRACTION),
  );
  const spendable = Math.max(price, reserveSpend);
  const qty = Math.min(
    Math.floor(spendable / price),
    holdFree,
    maxQty ?? Infinity,
  );
  if (qty > 0) {
    ts.executeTrade(
      player,
      planet,
      preferredGood,
      qty,
      true,
      capacity,
      engine.bank,
    );
  }
}

/**
 * Restore the player's hull at the cheapest available rate (planet-Верфь pricing:
 * 2 cr/HP). Mirrors `PlanetScene.doHullRepair` without the UI: syncs the loadout
 * max, checks affordability, deducts credits via the banking bus, then calls
 * `ship.repair()`. Safe no-op when hull is already perfect or credits are
 * insufficient. Dev-only helper — shared by `PlayerAgent.repair` and tests.
 */
export function executeRepair(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const ship = player.ship;
  const loadout = engine.playerLoadout;
  if (loadout) applyLoadoutHullToShip(ship, loadout);
  const status = hullStatus(
    ship.hullHP,
    ship.maxHull,
    loadout?.derivedStats().maxHull,
  );
  if (status.isPerfect) return;
  const cost = Math.ceil(status.missing * 2);
  if (player.credits < cost) return;
  adjustPlayerCredits(
    engine.bank,
    player,
    -cost,
    GL_COUNTERPARTY.SERVICES,
    "Ремонт корпуса",
  );
  ship.repair();
}
