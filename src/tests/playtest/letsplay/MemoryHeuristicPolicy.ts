/**
 * Letsplay engine — the memory-using heuristic (the BC teacher, dev-only).
 *
 * A {@link PlayerPolicy} that plays like a human by reasoning over its **belief
 * state** ({@link AgentMemory}) instead of only the egocentric {@link Observation}.
 * Where {@link HeuristicPolicy} is memoryless — it trades blindly on whatever
 * planet it happens to be on — this policy carries what it has *seen* across steps
 * and uses it for multi-step, goal-sequenced play:
 *
 *  - **buy low + remember.** Standing on the planet its price book says is the
 *    cheapest source for a good it can resell elsewhere at a profit ⇒ `trade` to
 *    buy (recorded with a buy-price lot the moment cargo grows).
 *  - **sell where the margin is best.** Holding cargo that `profitIfSoldHere` says
 *    is worth more than it paid ⇒ `trade` to sell; in flight it *returns* to the
 *    remembered sell planet (`land`, targeting it) to realise the known margin —
 *    the behaviour the memoryless baseline cannot produce.
 *  - **save toward a known upgrade.** A known offer it cannot yet afford is
 *    **deferred** (it keeps earning); once affordable it routes to the offer's
 *    location to go get it.
 *  - **avoid known-dangerous systems.** When the system it is working toward is
 *    remembered as dangerous, it does not push deeper while hurt — it finishes a
 *    local trade / heads to repair first rather than warping into the threat.
 *
 * Every decision is filtered through `obs.legalActions` (and `"wait"` is always
 * legal), so — exactly like the baseline — it can **never** return an illegal
 * action and never throws. The core {@link decideWithMemory} is **pure**: the same
 * `(obs, memory)` always yields the same action, which is what makes it a clean
 * behavioural-cloning teacher and lets the scripted A/B/C scenario be unit-tested
 * in isolation. The {@link MemoryHeuristicPolicy} class is a thin stateful adapter
 * that folds each observation into a per-run notebook so it is also a drop-in
 * {@link PlayerPolicy} for the agent loop. Lives under `src/tests/` and is dev-only.
 */
import { FactionType, SceneType } from "@/types";
import type { ResourceType } from "@/types";
import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { LOW_HULL_FRACTION } from "./HeuristicPolicy";
import {
  type AgentMemory,
  createMemory,
  detectDeadlock,
  updateMemory,
} from "./AgentMemory";
import type { ScenarioGoal } from "./goalBias";
import {
  bestKnownMargin,
  cheapestKnownOffer,
  profitIfSoldHere,
  routeDangerToGoal,
} from "./memoryFeatures";

/**
 * Above this hull fraction the agent treats itself as "battle-ready" — below it,
 * a remembered-dangerous goal makes it earn / repair before pressing on rather
 * than warping into the threat.
 */
export const BATTLE_READY_HULL_FRACTION = 0.99;

/** One ranked action candidate: a legal-or-not preference the legal filter prunes. */
interface Candidate {
  kind: PlayerActionKind;
  targetId?: string;
  reason: string;
}

/** Total units of `good` currently held across all FIFO lots. */
function heldQty(mem: AgentMemory, good: ResourceType | null): number {
  if (!good) return 0;
  let qty = 0;
  for (const lot of mem.inventoryLots) if (lot.good === good) qty += lot.qty;
  return qty;
}

/** True when the agent is carrying no cargo at all (free to start a fresh buy). */
function holdsNothing(mem: AgentMemory): boolean {
  return mem.inventoryLots.every((l) => l.qty <= 0);
}

/** Whether `planetId` is one of the planets in the player's current system. */
function planetInSystem(obs: Observation, planetId: string | null): boolean {
  if (!planetId) return false;
  return (obs.system?.planets ?? []).some((p) => p.id === planetId);
}

/** Whether `stationId` is one of the stations in the player's current system. */
function stationInSystem(obs: Observation, stationId: string | null): boolean {
  if (!stationId) return false;
  return (obs.system?.stations ?? []).some((s) => s.id === stationId);
}

/** The in-system planet the agent prefers to head to for generic earning. */
function earnPlanetId(obs: Observation): string | undefined {
  const planets = obs.system?.planets ?? [];
  // Only consider habitable planets — uninhabited planets have no market, so
  // landing there provides no value and creates an early-explore warp cycle.
  const habitable = planets.filter((p) => p.isHabitable !== false);
  const withWork = habitable.find((p) => p.availableQuests > 0);
  return (withWork ?? habitable[0])?.id;
}

// --- CJM (Customer Journey Map) teacher behaviors -------------------------
//
// Each `decideXxx` below is a self-contained, goal-specific bias: given the
// `legal` set for the current scene, it either returns one legal, fully
// resolved `Action` (its own priority fired and is currently permitted) or
// `null` (defer — the goal has nothing to add here, fall through to the
// scene's ordinary `decideWithMemory` sequencing below, which already covers
// generic trade/earn/explore/survive). None of these ever invents an illegal
// action: every branch checks `legal.has(...)` before returning.

/** Build a goal-branch `Action`, tagging the reason `mem:cjm:<goal>:<detail>`. */
function cjmAction(
  goal: ScenarioGoal,
  kind: PlayerActionKind,
  detail: string,
  targetId?: string,
): Action {
  return { kind, targetId, reason: `mem:cjm:${goal}:${detail}` };
}

/** CJM-A buffer: only borrow when the known margin clears loan cost by this factor. */
const TRADE_MAGNATE_LOAN_PROFIT_MULTIPLIER = 1.5;
/** CJM-A: a flat estimate of what a standard loan costs to service (no live loan-terms read at decide-time). */
const TRADE_MAGNATE_LOAN_COST_ESTIMATE = 500;

/**
 * CJM-A Trade magnate: clear an outstanding loan immediately once credits are
 * on hand, and borrow to fund a bulk buy only when the best known cross-planet
 * margin (scaled by the full hold) comfortably clears the loan's cost. All
 * other trading (buy-low / sell-high / route-to-sell) is already the base
 * policy's job, so this defers (`null`) whenever neither condition fires.
 */
function decideTradeMagnate(
  obs: Observation,
  mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const credits = obs.player?.credits ?? 0;
  if (mem.loanState && credits > 0 && legal.has("repay-loan")) {
    return cjmAction("trade-magnate", "repay-loan", "repay");
  }
  const best = bestKnownMargin(mem);
  const cargoCap = obs.player?.cargoCapacity ?? 0;
  const estimatedProfit = best.margin * cargoCap;
  if (
    !mem.loanState &&
    best.good != null &&
    estimatedProfit >
      TRADE_MAGNATE_LOAN_COST_ESTIMATE * TRADE_MAGNATE_LOAN_PROFIT_MULTIPLIER &&
    legal.has("take-loan")
  ) {
    return cjmAction("trade-magnate", "take-loan", "loan-for-margin");
  }
  return null;
}

/** CJM-B buffers: route to shop only once credits clear the price by this margin. */
const GEAR_GRINDER_HULL_BUFFER = 1.1;
const GEAR_GRINDER_GEAR_BUFFER = 1.2;

/**
 * CJM-B Gear grinder: hull upgrade first, then generic gear, then a
 * craft-center module — each gated on an affordability buffer so the agent
 * doesn't spend down to zero the instant it can technically afford something.
 * Defers to the base policy's trade/earn logic to accumulate credits otherwise.
 */
function decideGearGrinder(
  obs: Observation,
  _mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const credits = obs.player?.credits ?? 0;
  const bestHullPrice = obs.bestHullPrice ?? null;
  const cheapestGearPrice = obs.cheapestGearPrice ?? null;
  if (
    bestHullPrice != null &&
    credits >= bestHullPrice * GEAR_GRINDER_HULL_BUFFER &&
    legal.has("upgrade-hull")
  ) {
    return cjmAction("gear-grinder", "upgrade-hull", "hull-upgrade");
  }
  if (
    cheapestGearPrice != null &&
    credits >= cheapestGearPrice * GEAR_GRINDER_GEAR_BUFFER &&
    legal.has("buy-gear")
  ) {
    return cjmAction("gear-grinder", "buy-gear", "best-gear");
  }
  if (obs.hasCraftCenter && legal.has("buy-module")) {
    return cjmAction("gear-grinder", "buy-module", "micromodule");
  }
  return null;
}

/** CJM-C: below this hull fraction a fight is engaged in full; above, disengage. */
const BOUNTY_HUNTER_ENGAGE_HULL_FRACTION = 0.5;
/** CJM-C: below this hull fraction the base survive branch (repair/dock) takes over. */
const BOUNTY_HUNTER_RETREAT_FLOOR_FRACTION = 0.3;

/** The remembered-dangerous system with the worst known threat, or `null` if none seen. */
function mostDangerousKnownSystem(mem: AgentMemory): string | null {
  let worst: string | null = null;
  let worstDanger = 0;
  for (const [systemId, danger] of mem.threatMap) {
    if (danger > worstDanger) {
      worstDanger = danger;
      worst = systemId;
    }
  }
  return worst;
}

/**
 * CJM-C Combat hunter: engage a present hostile while healthy, disengage to
 * repair in the 30–50% hull band, and — with nothing local to fight — head
 * toward the most dangerous system it remembers. A critically low hull (<30%)
 * defers to the base survive branch's flee/repair/dock sequencing.
 */
function decideBountyHunter(
  obs: Observation,
  mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const hull = obs.player?.hullFraction ?? 1;
  if (obs.hostiles.length > 0) {
    const tid = obs.hostiles[0]?.id;
    if (hull > BOUNTY_HUNTER_ENGAGE_HULL_FRACTION && legal.has("attack")) {
      return cjmAction("bounty-hunter", "attack", "engage", tid);
    }
    if (
      hull <= BOUNTY_HUNTER_ENGAGE_HULL_FRACTION &&
      hull >= BOUNTY_HUNTER_RETREAT_FLOOR_FRACTION &&
      legal.has("flee")
    ) {
      return cjmAction("bounty-hunter", "flee", "disengage-to-repair", tid);
    }
    return null; // critically hurt — defer to the base survive branch
  }
  const cargoUsed = obs.player?.cargoUsed ?? 0;
  // A tracked lot bought at THIS planet's own price nets <= 0 sold right back
  // here (sell is always strictly below buy on one planet) — that is a known
  // loss, not loot to unload. Untracked cargo (no lots — the loot case, where
  // updateMemory never saw a market buy) still fires unconditionally below.
  const knownLossHere =
    mem.inventoryLots.length > 0 &&
    obs.currentPlanet != null &&
    profitIfSoldHere(obs, mem) <= 0;
  if (cargoUsed > 0 && legal.has("sell-cargo") && !knownLossHere) {
    return cjmAction("bounty-hunter", "sell-cargo", "sell-loot");
  }
  if (mostDangerousKnownSystem(mem) && legal.has("warp")) {
    return cjmAction("bounty-hunter", "warp", "hunt-danger");
  }
  return null;
}

/**
 * CJM-D Quest runner: always bank an offered contract first; with a delivery
 * target known and not already there, warp to close the distance. Landing at
 * the delivery system itself is left to the base policy's land/dock sequencing.
 */
function decideQuestRunner(
  obs: Observation,
  mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  if (legal.has("take-quest")) {
    return cjmAction("quest-runner", "take-quest", "accept");
  }
  if (obs.questDeliveryHere) return null; // let the base policy land/dock here
  const hasDelivery =
    mem.activeQuestDelivery.length > 0 ||
    obs.quests.some((q) => q.targetSystemId);
  if (hasDelivery && legal.has("warp")) {
    return cjmAction("quest-runner", "warp", "deliver");
  }
  return null;
}

/** CJM-E: below this hull fraction near the core, retreat instead of pressing on. */
const OVERMIND_SLAYER_RETREAT_HULL_FRACTION = 0.4;
/** CJM-E: minimum remembered Overmind share before the goal starts pushing toward it. */
const OVERMIND_SLAYER_ENGAGE_SHARE = 0.1;

/**
 * CJM-E Overmind slayer: retreat when hurt near the core, attack any hostile
 * at/adjacent to the core (Overmind ships), and otherwise push toward the
 * front once the Overmind holds a meaningful galaxy share.
 */
function decideOvermindSlayer(
  obs: Observation,
  _mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const hull = obs.player?.hullFraction ?? 1;
  if (obs.nearOvermindCore && hull < OVERMIND_SLAYER_RETREAT_HULL_FRACTION) {
    if (legal.has("flee"))
      return cjmAction(
        "overmind-slayer",
        "flee",
        "retreat",
        obs.hostiles[0]?.id,
      );
    if (legal.has("repair"))
      return cjmAction("overmind-slayer", "repair", "retreat");
    return null;
  }
  if (obs.nearOvermindCore && obs.hostiles.length > 0 && legal.has("attack")) {
    return cjmAction(
      "overmind-slayer",
      "attack",
      "core-assault",
      obs.hostiles[0]?.id,
    );
  }
  if (
    (obs.overmindShare ?? 0) > OVERMIND_SLAYER_ENGAGE_SHARE &&
    !obs.nearOvermindCore &&
    legal.has("warp")
  ) {
    return cjmAction("overmind-slayer", "warp", "advance");
  }
  return null;
}

/** CJM-F: above this hull fraction, raid a present hostile. */
const PIRATE_ATTACK_HULL_FRACTION = 0.5;

/**
 * CJM-F Pirate: avoid the lawful/bank faction (the closest observable proxy
 * for "military/ranger zones" — no NPC role is exposed on {@link Observation},
 * only `faction`), otherwise raid while healthy and fence loot once clear.
 */
function decidePirate(
  obs: Observation,
  _mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const hull = obs.player?.hullFraction ?? 1;
  const lawfulHostile = obs.hostiles.find(
    (n) => n.faction === FactionType.BASTIONS,
  );
  if (lawfulHostile && legal.has("flee")) {
    return cjmAction("pirate", "flee", "avoid-law", lawfulHostile.id);
  }
  if (
    obs.hostiles.length > 0 &&
    hull > PIRATE_ATTACK_HULL_FRACTION &&
    legal.has("attack")
  ) {
    return cjmAction("pirate", "attack", "raid", obs.hostiles[0]?.id);
  }
  const cargoUsed = obs.player?.cargoUsed ?? 0;
  if (cargoUsed > 0 && legal.has("sell-cargo")) {
    return cjmAction("pirate", "sell-cargo", "fence-loot");
  }
  return null;
}

/** CJM-G: below this credit balance, land to earn before resuming exploration. */
const EXPLORER_LOW_CREDITS = 200;

/**
 * CJM-G Explorer: keep warping while solvent; when credits run low, land at
 * the local planet most likely to offer work first, then resume roaming.
 */
function decideExplorer(
  obs: Observation,
  _mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const credits = obs.player?.credits ?? 0;
  const earnPlanet = earnPlanetId(obs);
  // Only land when there is a habitable planet to land on — landing on an
  // uninhabited planet (earnPlanet === undefined) has no market and causes a
  // spin-land-takeoff loop that also disconnects the live autopilot.
  if (
    credits < EXPLORER_LOW_CREDITS &&
    legal.has("land") &&
    earnPlanet !== undefined
  ) {
    return cjmAction("explorer", "land", "earn-first", earnPlanet);
  }
  if (legal.has("warp")) {
    return cjmAction("explorer", "warp", "roam");
  }
  return null;
}

/** Dispatch a {@link ScenarioGoal} to its CJM branch; unhandled goals defer (`null`). */
function decideForGoal(
  goal: ScenarioGoal,
  obs: Observation,
  mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  switch (goal) {
    case "trade-magnate":
      return decideTradeMagnate(obs, mem, legal);
    case "gear-grinder":
      return decideGearGrinder(obs, mem, legal);
    case "bounty-hunter":
      return decideBountyHunter(obs, mem, legal);
    case "quest-runner":
      return decideQuestRunner(obs, mem, legal);
    case "overmind-slayer":
      return decideOvermindSlayer(obs, mem, legal);
    case "pirate":
      return decidePirate(obs, mem, legal);
    case "explorer":
      return decideExplorer(obs, mem, legal);
    default:
      // The older GoalBiasedPolicy-only goals (go-broke/max-rep/ignore-overmind/
      // hoard/free-explore) have no MemoryHeuristicPolicy-level CJM bias.
      return null;
  }
}

/**
 * The pure decision core: choose one legal {@link Action} for `obs` given the
 * `mem` belief state. A compound worst-case deadlock forces `wait` outright
 * (wired ahead of every goal and the base sequencing below); otherwise, with a
 * `goal`, its CJM branch gets first refusal before falling through to the
 * goal-less survive→trade→earn→explore ranked candidate list (memory-aware),
 * returning the first candidate the current scene legally permits, with
 * `"wait"` as the guaranteed floor. Never mutates either argument and never
 * throws — the same `(obs, mem, goal)` always yields the same action.
 */
export function decideWithMemory(
  obs: Observation,
  mem: AgentMemory,
  goal?: ScenarioGoal,
): Action {
  const legal = new Set(obs.legalActions);

  if (detectDeadlock(obs, mem)) {
    return { kind: "wait", reason: "mem:deadlock" };
  }

  const candidates: Candidate[] = [];
  const push = (kind: PlayerActionKind, reason: string, targetId?: string) =>
    candidates.push({ kind, targetId, reason });

  const hull = obs.player?.hullFraction ?? 1;
  const hurt = hull < LOW_HULL_FRACTION;
  const credits = obs.player?.credits ?? 0;
  const cargoUsed = obs.player?.cargoUsed ?? 0;
  const cargoCap = obs.player?.cargoCapacity ?? 0;
  const hasHold = cargoCap > 0 && cargoUsed < cargoCap;

  // 1) Survive — react to a present threat first, then patch a low hull.
  if (obs.hostiles.length > 0) {
    const tid = obs.hostiles[0]?.id;
    if (hurt) {
      push("flee", "flee-low-hull", tid);
      push("attack", "fight", tid);
    } else {
      push("attack", "fight", tid);
      push("flee", "flee", tid);
    }
  }
  if (hurt) {
    push("repair", "repair-low-hull");
    push("dock", "dock-to-repair", obs.system?.stations[0]?.id);
  }

  const best = bestKnownMargin(mem);
  const offer = cheapestKnownOffer(mem);
  const canAffordOffer = offer ? credits >= offer.price : false;
  const danger = routeDangerToGoal(obs, mem);
  // Heading into a remembered-dangerous goal while not battle-ready ⇒ hold back.
  const avoidDanger = danger > 0 && hull < BATTLE_READY_HULL_FRACTION;

  // 2) If a hyperjump is already in transit (ship flying to system edge), wait —
  // opening StarMap would cancel the pending warp. Highest priority after survive,
  // EXCEPT a genuinely engaged hostile still needs its combat reaction (the
  // survive candidates pushed above) rather than being discarded for "wait":
  // attack/flee don't touch the planned route, so they can't disturb the warp.
  if (obs.warpInTransit && obs.hostiles.length === 0) {
    return { kind: "wait", reason: "mem:warp-in-transit" };
  }

  // 2.5) A goal's CJM branch gets first refusal — a legal preference here wins
  // outright; no preference (null) falls through to the goal-less sequencing.
  if (goal) {
    const goalAction = decideForGoal(goal, obs, mem, legal);
    if (goalAction) return goalAction;
  }

  // 3) Memory-driven trade + goal sequencing, by scene.
  switch (obs.scene) {
    case SceneType.PLANET: {
      const landedId = obs.currentPlanet?.id ?? null;
      // Sell held cargo here when the remembered buy-price says it profits.
      const profitHere = profitIfSoldHere(obs, mem);
      if (profitHere > 0) push("trade", `sell-for-profit:${profitHere}`);
      // Buy low: standing on the cheapest source for a known cross-planet margin,
      // with credits + hold space and nothing already in tow.
      const buyPrice =
        best.good != null
          ? (obs.currentPlanet?.market.find((m) => m.resource === best.good)
              ?.buy ?? Infinity)
          : Infinity;
      if (
        best.good != null &&
        best.buyPlanet === landedId &&
        holdsNothing(mem) &&
        hasHold &&
        credits >= buyPrice
      ) {
        push("trade", `buy-low:${best.good}`);
      }
      // Earn — take offered work, else inspect the market, else take off.
      if ((obs.currentPlanet?.availableQuests ?? 0) > 0)
        push("take-quest", "take-work");
      // Skip market re-visit when already holding cargo: would sell at a loss
      // (same-planet sell < buy) and keeps the agent stuck on one planet.
      // Instead fall through to take-off so the agent warps to the sell planet.
      if (mem.inventoryLots.length === 0) push("trade", "inspect-market");
      push("move", "take-off");
      break;
    }
    case SceneType.SPACE_FLIGHT: {
      // Realise a known sell: holding the good and its sell planet is in-system.
      if (
        best.good != null &&
        heldQty(mem, best.good) > 0 &&
        planetInSystem(obs, best.sellPlanet)
      ) {
        push("land", "go-sell", best.sellPlanet ?? undefined);
      }
      // Start a known buy: empty hold and the cheap source is in-system.
      if (
        best.good != null &&
        holdsNothing(mem) &&
        planetInSystem(obs, best.buyPlanet)
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      // Pursue an affordable upgrade: route to the offer's in-system location.
      if (offer && canAffordOffer) {
        if (planetInSystem(obs, offer.location))
          push("land", "go-upgrade", offer.location);
        else if (stationInSystem(obs, offer.location))
          push("dock", "go-upgrade", offer.location);
      }
      // Warp to find the sell destination when:
      //  - holding cargo AND best sell planet not in this system, OR
      //  - holding cargo AND no sell planet known (priceBook only covers this system)
      // Both cases need exploration; the second is the early-game cycle-breaker.
      const holdingForOtherSystem =
        mem.inventoryLots.length > 0 &&
        (best.sellPlanet === null || !planetInSystem(obs, best.sellPlanet));
      if (holdingForOtherSystem && !avoidDanger) {
        push("warp", "find-sell-destination");
      }
      // Generic earn — head to local commerce.
      // Early exploration: if the nearest earn planet was already visited this
      // session (it's in the price book) but there's still no cross-system margin,
      // warp to explore a NEW system BEFORE landing on the same planet again.
      // This breaks the "visit same planet forever" cycle: the warp fires only
      // after the first visit; a fresh system resets alreadyVisited=false so the
      // agent lands on the new planet first. Positioned before land "earn" so
      // warp wins over the repeated same-planet land when the condition is met.
      const earnPlanet = earnPlanetId(obs);
      // An uninhabited visit stores an empty goods map — require at least one
      // known good so the "already explored" signal is only true after a real
      // market visit (prevents the warp-cycle on all-uninhabited systems).
      const alreadyVisited =
        earnPlanet !== undefined &&
        (mem.priceBook.get(earnPlanet)?.size ?? 0) > 0;
      if (
        alreadyVisited &&
        best.fraction === 0 &&
        !avoidDanger &&
        mem.inventoryLots.length === 0 &&
        !offer
      ) {
        push("warp", "early-explore");
      }
      if (earnPlanet !== undefined) {
        push("land", "earn", earnPlanet);
      }
      push("dock", "earn", obs.system?.stations[0]?.id);
      // Explore — but don't warp deeper into a remembered threat while hurt.
      if (avoidDanger) {
        push("move", "avoid-danger-hold");
        push("warp", "explore");
      } else {
        push("warp", "explore");
        push("move", "fly");
      }
      break;
    }
    case SceneType.STAR_MAP: {
      // Don't jump toward a remembered threat while not battle-ready.
      if (avoidDanger) push("move", "avoid-danger-back");
      push("warp", "warp");
      push("move", "back");
      break;
    }
    case SceneType.STATION: {
      push("repair", "repair");
      push("move", "leave");
      break;
    }
    case SceneType.TRADE: {
      // Execute the actual trade (headless: executeTradeOnPlanet; live: no-op via
      // openTrade which already ran inline). Without this push the headless two-step
      // (PLANET→TRADE→execute) never completes: the agent opens TRADE then
      // immediately leaves without buying/selling, so cargo stays at 0 forever.
      push("trade", "do-trade");
      push("move", "leave-market");
      break;
    }
    default: {
      // Dialogue / inventory / equipment / terminal screens — read and back out.
      push("move", "back");
      break;
    }
  }

  push("wait", "idle"); // universal fallback — always legal.

  const pick = candidates.find((c) => legal.has(c.kind)) ?? {
    kind: "wait" as PlayerActionKind,
    reason: "idle",
  };
  return {
    kind: pick.kind,
    targetId: pick.targetId,
    reason: `mem:${pick.reason}`,
  };
}

/**
 * The memory-using player. A thin stateful adapter over {@link decideWithMemory}:
 * it owns a **per-run** {@link AgentMemory} notebook and, when called as a plain
 * {@link PlayerPolicy} (`decide(obs)`), folds each observation in before deciding,
 * so belief accumulates across the agent loop. Pass an explicit `memory` (the
 * agent-owned notebook, already updated for this step) to use it directly without
 * a second fold. Call {@link reset} on a new game to start fresh (a human starting
 * over). Construct once per run.
 */
export class MemoryHeuristicPolicy implements PlayerPolicy {
  readonly name = "memory-heuristic";

  private memory: AgentMemory;

  /**
   * @param memory Pre-seeded notebook (defaults to a fresh one).
   * @param goal Optional CJM bias (Task 4) — when set, that goal's branch gets
   *   first refusal every decide before the goal-less sequencing runs.
   */
  constructor(
    memory?: AgentMemory,
    private readonly goal?: ScenarioGoal,
  ) {
    this.memory = memory ?? createMemory();
  }

  /** The current belief notebook (inspectable for transcripts / tests). */
  get belief(): AgentMemory {
    return this.memory;
  }

  /** Start a fresh per-run notebook — call when a new game begins. */
  reset(): void {
    this.memory = createMemory();
  }

  /**
   * Choose one legal action. With an explicit `memory` (the agent already folded
   * this step's observation in — Task 5 wiring), decide over it directly. Without
   * one, self-manage: fold `obs` into the owned notebook, then decide — so a bare
   * `decide(obs)` is a drop-in {@link PlayerPolicy} whose belief grows step over
   * step. Pure-cored, never throws, always returns a legal action.
   */
  decide(obs: Observation, memory?: AgentMemory): Action {
    if (memory) return decideWithMemory(obs, memory, this.goal);
    this.memory = updateMemory(this.memory, obs);
    return decideWithMemory(obs, this.memory, this.goal);
  }
}
