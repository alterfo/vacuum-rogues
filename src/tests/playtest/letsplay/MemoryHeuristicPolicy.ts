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
import type { Observation, PlayerActionKind, SystemSnapshot } from "./observe";
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

/**
 * Below this fuel fraction the survival tier takes over: land on any in-system
 * habitable planet to refuel (landing always tops the tank off for free — see
 * `SpaceFlightScene.onLandOnPlanet`), and no `warp` candidate is emitted at all
 * (a warp only ever burns fuel, and every planeted system reaches a refuel via
 * `land`, so this alone eliminates fuel-death).
 */
export const REFUEL_THRESHOLD = 0.2;

/**
 * Cap on system-to-system hops the base ladder will take back-to-back without
 * an intervening landing. Without this cadence, a goal-less agent holding
 * cargo for an unknown sell planet can blind-warp system after system forever
 * (see `MemoryHeuristicPolicy`'s loop-breaker below) — this is the backstop
 * that forces a land (or at minimum stops emitting `warp`) once tripped.
 */
export const MAX_CONSECUTIVE_WARPS_WITHOUT_LAND = 2;

/**
 * Below this hull fraction near a rising Overmind front, the goal-less base
 * ladder proactively leaves the system (`warp` away) instead of idling —
 * distinct from `LOW_HULL_FRACTION` (an active hostile's fight-or-flee
 * cutoff): this fires even with no hostile present, purely off the
 * remembered front signal.
 */
export const OVERMIND_THREAT_HULL_FRACTION = 0.6;

/**
 * Galaxy-wide Overmind share above which the front counts as "rising" even
 * when the current system isn't (yet) adjacent to the core — the other half
 * of the `overmindThreatening` signal alongside `nearOvermindCore`.
 */
export const OVERMIND_THREAT_SHARE = 0.15;

/**
 * The base-ladder `warp` reasons that get a Task 5 smart-picked `targetId`
 * (see `pickWarpNeighbor`) — the threat and explore tiers, where "toward the
 * unknown, away from the Overmind" is a genuinely better heuristic than a
 * blind pick. Deliberately excludes the economy tier's
 * `find-sell-destination` (see the call site for why).
 */
const WARP_TARGETING_REASONS = new Set([
  "flee-overmind-front",
  "early-explore",
  "explore",
  "warp",
]);

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

/**
 * Choose a `warp` destination from the current system's neighbor detail
 * (Task 5) — "direction of the unknown, away from the Overmind": rank each
 * neighbor by `overmindHeld` (weight 4), whether `mem.threatMap` remembers it
 * as having hostiles (weight 3 — don't walk back into a fight the agent has
 * already had here), whether the agent has actually **traveled** there this
 * session per `mem.visitedSystemIds` (weight 3 — see below), whether it's
 * `previousSystemId` (weight 2 — the system just left, avoided so two
 * mutually-adjacent systems don't ping-pong forever), then the observation's
 * own `visited` fog-of-war flag (weight 1), and take the lowest score.
 *
 * `mem.visitedSystemIds` is weighted well above the raw `visited` field
 * because `visited` mirrors `StarSystem.explored` — real-engine galaxy
 * generation pre-reveals a whole pocket of systems around the home system at
 * game start, so nearly every early neighbor already reads `visited: true`
 * despite the agent never having actually traveled there. Scoring on that
 * alone made every home-pocket neighbor look equally "already seen," so the
 * picker cycled among the 2-3 systems it kept actually landing in (a
 * real-engine regression: repeatedly returning to the same system let its
 * Overmind garrison grow across visits until it became fatal). Session-actual
 * `visitedSystemIds` breaks that tie correctly; `visited` remains a lighter
 * secondary signal for systems outside the pre-revealed pocket.
 *
 * Falls back to the least-bad neighbor (Overmind-held, remembered-dangerous,
 * or straight back the way it came) only when that's the sole way out.
 * Returns `undefined` when `obs` carries no neighbor detail at all (older
 * hand-built fixtures) — callers then fall back to the appliers' blind
 * `pickWarpTarget`.
 */
function pickWarpNeighbor(
  neighbors: SystemSnapshot["neighbors"],
  mem: AgentMemory,
): string | undefined {
  if (!neighbors || neighbors.length === 0) return undefined;
  let bestId: string | undefined;
  let bestScore = Infinity;
  for (const n of neighbors) {
    const score =
      (n.overmindHeld ? 4 : 0) +
      ((mem.threatMap.get(n.systemId) ?? 0) > 0 ? 3 : 0) +
      (mem.visitedSystemIds.has(n.systemId) ? 3 : 0) +
      (n.systemId === mem.previousSystemId ? 2 : 0) +
      (n.visited ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestId = n.systemId;
    }
  }
  return bestId;
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

  // Fuel survival — refuel before the tank runs dry. Landing on any habitable
  // planet in-system refuels to full at no fuel cost, so a critical fuel
  // fraction routes there ahead of everything below (trade/progress/explore).
  // `fuelGate` additionally suppresses every `warp` candidate this call could
  // otherwise emit — a warp only ever burns fuel, and burning more while
  // already critical is exactly the stranding this tier exists to prevent.
  const fuelFraction = obs.player?.fuelFraction ?? 1;
  const fuelCritical = fuelFraction < REFUEL_THRESHOLD;
  const fuelGate = fuelCritical;
  if (fuelCritical) {
    const refuelPlanet = (obs.system?.planets ?? []).find(
      (p) => p.isHabitable !== false,
    )?.id;
    if (refuelPlanet) push("land", "refuel-critical", refuelPlanet);
  }

  // 1.5) Threat/Overmind — leave a rising front while not battle-ready. Gated
  // on no *present* hostile: a live engagement defers entirely to the
  // survive block above's fight-or-flee-by-hull reaction (`attack`/`flee`),
  // which — unlike `warp` — is never legal from STAR_MAP, so attempting a
  // warp jump while still under fire risks getting caught by an in-flight
  // combat intercept mid-transit and finished off (real-engine regression:
  // a hull=10 ship survived indefinitely disengaging via `avoid-danger-back`
  // pre-fix, but died mid-warp once this tier pre-empted that branch).  This
  // tier instead reacts to the remembered front itself once the system is
  // calm, so the agent doesn't idle/trade in a system the Overmind is
  // closing in on with nothing currently shooting at it. Ungated by the
  // anti-consecutive-warp cadence (escaping the front overrides the
  // loop-prevention heuristic) but still respects the fuel gate — fleeing on
  // an empty tank just strands the ship, and the fuel tier above already
  // routes to a refuel landing first when one is available.
  const overmindThreatening =
    obs.nearOvermindCore || (obs.overmindShare ?? 0) > OVERMIND_THREAT_SHARE;
  if (
    overmindThreatening &&
    hull < OVERMIND_THREAT_HULL_FRACTION &&
    !fuelGate &&
    obs.hostiles.length === 0
  ) {
    push("warp", "flee-overmind-front");
  }

  const best = bestKnownMargin(mem);
  // The margin restricted to goods actually held right now — distinct from
  // `best` (which can surface a bigger margin for a good the agent doesn't
  // have, useful for the buy-low/go-buy guidance below). Selling decisions
  // must reason about what's *in the hold*: using the unrestricted `best`
  // here previously let an unrelated, larger known margin (for a good never
  // bought) mask the held good's own sell opportunity — the agent believed
  // "the best sell planet is right here" and never realised it wasn't for
  // what it was carrying, stalling in an earn/take-off loop forever.
  const heldGoods = new Set(
    mem.inventoryLots.filter((l) => l.qty > 0).map((l) => l.good),
  );
  const bestHeld =
    heldGoods.size > 0
      ? bestKnownMargin(mem, (g) => heldGoods.has(g))
      : bestKnownMargin(mem, () => false);
  const offer = cheapestKnownOffer(mem);
  const canAffordOffer = offer ? credits >= offer.price : false;
  const danger = routeDangerToGoal(obs, mem);
  // Heading into a remembered-dangerous goal while not battle-ready ⇒ hold back.
  const avoidDanger = danger > 0 && hull < BATTLE_READY_HULL_FRACTION;
  // Anti-consecutive-warp cadence — once the run has hopped this many systems
  // in a row without landing, stop emitting `warp` from the base ladder so the
  // remaining candidates (land/dock/wait) get a chance to break the streak.
  const warpCadenceOk =
    mem.consecutiveWarpsWithoutLanding < MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;

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
        bestHeld.good != null &&
        heldQty(mem, bestHeld.good) > 0 &&
        planetInSystem(obs, bestHeld.sellPlanet)
      ) {
        push("land", "go-sell", bestHeld.sellPlanet ?? undefined);
      }
      // Start a known buy: empty hold and the cheap source is in-system.
      if (
        best.good != null &&
        holdsNothing(mem) &&
        planetInSystem(obs, best.buyPlanet)
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      // Progression — quest delivery: the current system is a carried quest's
      // delivery target. Land on any in-system planet to trigger
      // `PlanetScene.checkDeliveryQuestCompletion` — the real completion check
      // lives there (it silently no-ops on the wrong planet/cargo shortfall),
      // so the ladder only needs to get the ship down, not resolve the quest
      // itself. Ranked above the (memory-driven) upgrade routing below: a
      // deliverable-now quest is a closed loop, while the upgrade offer is
      // only ever a saving target.
      if (obs.questDeliveryHere) {
        const deliveryPlanet = (obs.system?.planets ?? [])[0]?.id;
        if (deliveryPlanet) push("land", "quest-delivery", deliveryPlanet);
      }
      // Pursue an affordable upgrade: route to the offer's in-system location.
      if (offer && canAffordOffer) {
        if (planetInSystem(obs, offer.location))
          push("land", "go-upgrade", offer.location);
        else if (stationInSystem(obs, offer.location))
          push("dock", "go-upgrade", offer.location);
      }
      // Generic earn target + whether landing there would teach the agent
      // anything new — hoisted here (used by both the loop-breaker below and
      // the "earn"/"early-explore" candidates further down).
      const earnPlanet = earnPlanetId(obs);
      // An uninhabited visit stores an empty goods map — require at least one
      // known good so the "already explored" signal is only true after a real
      // market visit (prevents the warp-cycle on all-uninhabited systems).
      const alreadyVisited =
        earnPlanet !== undefined &&
        (mem.priceBook.get(earnPlanet)?.size ?? 0) > 0;
      // Warp to find the sell destination when:
      //  - holding cargo AND best sell planet not in this system, OR
      //  - holding cargo AND no sell planet known (priceBook only covers this system)
      // Both cases need exploration; the second is the early-game cycle-breaker.
      const holdingForOtherSystem =
        mem.inventoryLots.length > 0 &&
        (bestHeld.sellPlanet === null ||
          !planetInSystem(obs, bestHeld.sellPlanet));
      // Loop-breaker: while holding cargo for a sell planet not in this
      // system, land on an unvisited in-system planet FIRST to populate the
      // price book (and maybe discover the margin outright) rather than
      // blind-warping — without this, `holdingForOtherSystem` always beats
      // "earn" below and the agent warps system-to-system forever, never
      // learning a second planet's prices (the warp-forever bug).
      if (
        holdingForOtherSystem &&
        earnPlanet !== undefined &&
        !alreadyVisited
      ) {
        push("land", "discover-prices", earnPlanet);
      }
      if (holdingForOtherSystem && !avoidDanger && !fuelGate && warpCadenceOk) {
        push("warp", "find-sell-destination");
      }
      // Early exploration: if the nearest earn planet was already visited this
      // session (it's in the price book) but there's still no cross-system margin,
      // warp to explore a NEW system BEFORE landing on the same planet again.
      // This breaks the "visit same planet forever" cycle: the warp fires only
      // after the first visit; a fresh system resets alreadyVisited=false so the
      // agent lands on the new planet first. Positioned before land "earn" so
      // warp wins over the repeated same-planet land when the condition is met.
      if (
        alreadyVisited &&
        best.fraction === 0 &&
        !avoidDanger &&
        !fuelGate &&
        warpCadenceOk &&
        mem.inventoryLots.length === 0 &&
        !offer
      ) {
        push("warp", "early-explore");
      }
      if (earnPlanet !== undefined) {
        push("land", "earn", earnPlanet);
      }
      push("dock", "earn", obs.system?.stations[0]?.id);
      // Explore — but don't warp deeper into a remembered threat while hurt,
      // never warp at all while fuel-critical, and respect the consecutive-warp
      // cadence (land/dock/wait only once it's tripped).
      if (avoidDanger) {
        push("move", "avoid-danger-hold");
        if (!fuelGate && warpCadenceOk) push("warp", "explore");
      } else {
        if (!fuelGate && warpCadenceOk) push("warp", "explore");
        push("move", "fly");
      }
      break;
    }
    case SceneType.STAR_MAP: {
      // Don't jump toward a remembered threat while not battle-ready.
      if (avoidDanger) push("move", "avoid-danger-back");
      if (!fuelGate && warpCadenceOk) push("warp", "warp");
      push("move", "back");
      break;
    }
    case SceneType.STATION: {
      // Progression — affordable upgrade: buy it now rather than idling with
      // spare credits. Reuses the CJM-B gear-grinder's affordability buffers
      // (same "don't spend down to exactly zero" reasoning) so the goal-less
      // ladder and that goal branch agree on when an upgrade is "worth it".
      const bestHullPrice = obs.bestHullPrice ?? null;
      const cheapestGearPrice = obs.cheapestGearPrice ?? null;
      if (
        bestHullPrice != null &&
        credits >= bestHullPrice * GEAR_GRINDER_HULL_BUFFER
      ) {
        push("upgrade-hull", "afford-hull-upgrade");
      }
      if (
        cheapestGearPrice != null &&
        credits >= cheapestGearPrice * GEAR_GRINDER_GEAR_BUFFER
      ) {
        push("buy-gear", "afford-gear");
      }
      if (obs.hasCraftCenter) push("buy-module", "afford-module");
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
  // Every threat/explore-tier `warp` candidate above is pushed without a
  // `targetId` (the ladder reasons about *whether* to jump, not *where*) —
  // fill in a chosen, smart destination here, in one place, rather than at
  // each push site. Scoped to the reasons the plan's needs-ladder actually
  // frames as "go toward the unknown, away from the Overmind" (threat +
  // explore tiers) — deliberately EXCLUDES the economy tier's
  // `find-sell-destination` (searching for *any* buyer has no "unvisited is
  // better" signal, and routing it through the same unvisited-biased pick
  // can walk a holding-cargo run into a system whose danger is only
  // discovered on arrival; blind selection there matches pre-Task-5
  // behavior).
  const targetId =
    pick.kind === "warp" &&
    pick.targetId === undefined &&
    WARP_TARGETING_REASONS.has(pick.reason)
      ? pickWarpNeighbor(obs.system?.neighbors, mem)
      : pick.targetId;
  return {
    kind: pick.kind,
    targetId,
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
