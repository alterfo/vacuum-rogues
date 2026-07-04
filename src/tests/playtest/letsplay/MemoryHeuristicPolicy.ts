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
import { FactionType, QuestType, SceneType } from "@/types";
import type { ResourceType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import type {
  Observation,
  PlayerActionKind,
  QuestSnapshot,
  SystemSnapshot,
} from "./observe";
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
import { deliveryCargoNeed, deliveryReadyToTurnIn } from "./observeHelpers";
import { questRoutingPreference } from "./engineQueries";

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
 * Folds without a galaxy-day boundary above which the base ladder stops
 * *starting new* buy cycles (`buy-low`/`go-buy`/price-discovery landings) —
 * `land` teleports (no flight simulated) and a `trade` costs no time either,
 * so a locally profitable buy-low/sell-for-profit round trip can otherwise be
 * farmed forever without a single calendar day passing (Task 1 of the
 * 20260703 plan wants the loop to fire, not to replace one inertness bug with
 * a same-planet-pair camping one). Sell-for-profit/go-sell stay ungated so
 * cargo already in the hold isn't stranded — this only stops NEW buys once
 * tripped, letting the agent naturally drain out to earn/explore/warp.
 */
export const MAX_FOLDS_WITHOUT_DAY_ADVANCE = 12;

/**
 * Consecutive no-progress STAR_MAP folds (`AgentMemory.starMapStallFolds`)
 * above which the STAR_MAP tier stops emitting `warp` and falls back to
 * `move` (leave to flight) instead. The live engine gates a jump on the
 * *absolute* fuel cost of the specific target (`StarMapScene.performWarpJump`),
 * which can exceed what's left even when `REFUEL_THRESHOLD`'s *fraction* gate
 * says warping is fine — that silent, feedback-free failure would otherwise
 * repeat the same `warp` decision forever, stranding the agent on the map
 * instead of returning to flight where the fuel-critical `land` tier can
 * still refuel.
 */
export const MAX_STAR_MAP_WARP_STALLS = 2;

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
 * Galaxy-wide Overmind share above which the ladder stops taking on NEW
 * DELIVERY quests — well below `OVERMIND_SPREAD_LOSS_SHARE` (0.85, the true
 * "galaxy lost" line in `balance.ts`), leaving room for an already-accepted
 * quest's own travel time. A quest's buy→warp→deliver cycle needs several
 * extra warps beyond the ladder's ordinary trading; committing to a NEW one
 * once the front is already this far along stacks that extra travel on top
 * of a galaxy where most remaining systems are Overmind-held — real-engine
 * regression: a fresh quest taken at ~90% share sent a full-hull ship
 * straight into an Overmind garrison system (6 hostiles) with no prior
 * memory signal to have avoided it, and it died fleeing (successfully,
 * repeatedly — just never escaping) before the front-avoidance tier above
 * this one could react to a merely "rising" front.
 */
export const QUEST_ACCEPT_OVERMIND_SHARE_CEILING = 0.6;

/**
 * Safety margin subtracted from `OVERMIND_SPREAD_LOSS_SHARE` (0.85) before
 * gating the ladder's own exploratory warps (see `galaxyEffectivelyLost`
 * below) — `overmindShare` is only a snapshot at decide time, and a spread
 * tick can still land during the warp's own multi-day transit, so the ladder
 * needs to stop exploring meaningfully *before* the true line, not at it.
 */
export const OVERMIND_LOSS_SAFETY_MARGIN = 0.05;

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
 *
 * `questTarget` (Task 2) biases this toward actually finishing a carried
 * DELIVERY quest: a DIRECT, non-Overmind-held neighbour match wins outright
 * (skipping the scoring below entirely — reaching a KNOWN destination beats
 * the generic explore heuristic). Otherwise, among neighbours tied on
 * *danger* (`overmindHeld`/remembered-threat — real safety, sorted first and
 * always dominant), a neighbour with a KNOWN `hopsToQuestTarget` (stamped by
 * `observe()`, the only place with full galaxy-graph access to compute the
 * BFS distance — see `SystemSnapshot.neighbors`) is ranked by that distance
 * INSTEAD OF the generic "already visited / came from here" explore
 * preference, not merely as a tie-break on top of it: a diagnostic 100-run
 * measured 94% of sessions taking a DELIVERY quest but 65% completing zero of
 * them when progress was only an exact-score tie-break (avg 0.36-0.38
 * quests/session, target ≥1) — the generic explore score (0-6) dwarfed the
 * old tie-break far too often for a multi-hop target to ever win. Danger
 * still sorts first and is never traded away; with no quest target (or an
 * unreachable one) every neighbour falls back to the plain explore score,
 * identical to before.
 */
function pickWarpNeighbor(
  neighbors: SystemSnapshot["neighbors"],
  mem: AgentMemory,
  questTarget?: string | null,
): string | undefined {
  if (!neighbors || neighbors.length === 0) return undefined;
  if (questTarget != null) {
    const direct = neighbors.find(
      (n) => n.systemId === questTarget && !n.overmindHeld,
    );
    if (direct) return direct.systemId;
  }
  let bestId: string | undefined;
  let bestDanger = Infinity;
  let bestProgress = Infinity;
  for (const n of neighbors) {
    const danger =
      (n.overmindHeld ? 4 : 0) +
      ((mem.threatMap.get(n.systemId) ?? 0) > 0 ? 3 : 0);
    const exploreScore =
      (mem.visitedSystemIds.has(n.systemId) ? 3 : 0) +
      (n.systemId === mem.previousSystemId ? 2 : 0) +
      (n.visited ? 1 : 0);
    const progress = n.hopsToQuestTarget ?? exploreScore;
    if (
      danger < bestDanger ||
      (danger === bestDanger && progress < bestProgress)
    ) {
      bestDanger = danger;
      bestProgress = progress;
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
    // Disengage from a fight we're likely to lose. A hostile whose hull HP
    // exceeds our *current* hull will out-trade us: empirically the
    // capture-fleet / Overmind craft carry far more hull than a starter ship
    // and delete it in ~2 combat days (100%→35%→0), so the plain `hurt`
    // (<35% hull) cutoff fires too late — one more combat day after it trips
    // is already lethal. Treat an over-HP'd enemy as a flee-now trigger even
    // at full hull, so the agent never trades blows with a capture fleet.
    const playerHull = obs.player?.hull ?? 0;
    const toughestHostileHull = Math.max(
      0,
      ...obs.hostiles.map((h) => h.hullHP ?? 0),
    );
    const outmatched = toughestHostileHull > playerHull;
    if (hurt || outmatched) {
      push("flee", outmatched ? "flee-outmatched" : "flee-low-hull", tid);
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

  // The galaxy is close enough to the true "arc lost" line (`balance.ts`
  // `OVERMIND_SPREAD_LOSS_SHARE`, 0.85) that nearly every remaining system is
  // an Overmind garrison, so a speculative exploration/margin-hunting warp is
  // no longer a reasonable bet. Checked with a safety margin BELOW the true
  // line, not at it: `overmindShare` is a snapshot at *decide* time, but a
  // warp's own transit spans several simulated days during which a spread
  // tick can still land — real-engine regression: a `find-sell-destination`
  // warp decided at 0.833 (just under the raw 0.85 line) arrived to find
  // share already at 0.917 mid-flight, dropping a full-hull ship straight
  // into a 6-ship garrison system. Gates the ladder's own exploratory warps
  // only — `flee-overmind-front` above (escaping, not exploring) and
  // STAR_MAP's own explore/back tiers are unaffected, since blocking every
  // warp everywhere once this share is reached would itself strand the ship.
  const galaxyEffectivelyLost =
    (obs.overmindShare ?? 0) >=
    GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE - OVERMIND_LOSS_SAFETY_MARGIN;

  const best = bestKnownMargin(mem);
  // Cargo committed to an active DELIVERY quest's COLLECT_ITEM need — never a
  // market position. Excluded below from `heldGoods`/`holdingForOtherSystem`:
  // those exist to route the ship toward a REMEMBERED cross-planet sell price,
  // which doesn't exist for quest cargo (it's turned in, never sold) — without
  // this exclusion, holding it while still accumulating the shortfall made the
  // ladder believe it needed to warp off hunting a "sell destination" that was
  // never the point, sending the agent into unscouted (and sometimes lethal)
  // systems purely as a side effect of buying quest cargo across more than one
  // visit.
  const questCommittedGoods = new Set(
    obs.quests
      .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
      .map((q) => q.collectItem!.type),
  );
  // The margin restricted to goods actually held right now — distinct from
  // `best` (which can surface a bigger margin for a good the agent doesn't
  // have, useful for the buy-low/go-buy guidance below). Selling decisions
  // must reason about what's *in the hold*: using the unrestricted `best`
  // here previously let an unrelated, larger known margin (for a good never
  // bought) mask the held good's own sell opportunity — the agent believed
  // "the best sell planet is right here" and never realised it wasn't for
  // what it was carrying, stalling in an earn/take-off loop forever.
  const heldGoods = new Set(
    mem.inventoryLots
      .filter((l) => l.qty > 0 && !questCommittedGoods.has(l.good))
      .map((l) => l.good),
  );
  const bestHeld =
    heldGoods.size > 0
      ? bestKnownMargin(mem, (g) => heldGoods.has(g))
      : bestKnownMargin(mem, () => false);
  const offer = cheapestKnownOffer(mem);
  const canAffordOffer = offer ? credits >= offer.price : false;
  // `routeDangerToGoal`'s `goalSystemId` prefers a carried quest's own target
  // system over the current one — right for "should I press on toward the
  // goal", wrong for "am I in danger right now": with an active quest, this
  // silently swapped in an unrelated (usually danger-free) system, masking
  // the CURRENT system's own remembered threat entirely. Real-engine
  // regression: a hostile fought once (hull 130→102) failed to trip
  // `avoidDanger` while a quest was active — STAR_MAP kept emitting `warp`
  // instead of holding back, and each new warp risked (and here, compounded
  // into) another hit, chaining to a death the exact same encounter survives
  // cleanly goal-less (where `goalSystemId` has nothing to fall back to but
  // the current system, so this danger is never masked). Folding in the
  // current system's own threat directly keeps that self-protection intact
  // regardless of whether a quest redirects the "goal".
  const currentSystemDanger = mem.threatMap.get(obs.system?.id ?? "") ?? 0;
  const danger = Math.max(routeDangerToGoal(obs, mem), currentSystemDanger);
  // Heading into a remembered-dangerous goal while not battle-ready ⇒ hold back.
  const avoidDanger = danger > 0 && hull < BATTLE_READY_HULL_FRACTION;
  // Anti-consecutive-warp cadence — once the run has hopped this many systems
  // in a row without landing, stop emitting `warp` from the base ladder so the
  // remaining candidates (land/dock/wait) get a chance to break the streak.
  const warpCadenceOk =
    mem.consecutiveWarpsWithoutLanding < MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;
  // No galaxy day has passed in too long — `land`/`trade` are both free in
  // time, so a good local margin can be farmed forever otherwise. Once
  // tripped, the ladder stops STARTING new buy cycles (existing cargo can
  // still be sold off) so the agent is forced back toward earn/explore/warp,
  // which are what actually advance the calendar.
  const daysStagnant =
    mem.foldsSinceDayAdvance >= MAX_FOLDS_WITHOUT_DAY_ADVANCE;
  // Shared by every exploratory-warp gate below: never warp while fuel-
  // critical, past the anti-consecutive-warp cadence, or once the galaxy is
  // effectively lost (near the real 0.85 loss share — see `galaxyEffectivelyLost`).
  const explorationSafe = !fuelGate && warpCadenceOk && !galaxyEffectivelyLost;

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
      // Sell held cargo here when the remembered buy-price says it profits —
      // unless that cargo is quest-committed (selling it away would strand
      // the delivery the ladder just spent credits building toward).
      // `profitIfSoldHere`/`heldGoods` already exclude quest-committed goods
      // (see `questCommittedGoods` above), so `profitHere`/held cargo here
      // can only ever be non-quest goods — no separate `readyDelivery` gate
      // is needed, and one would incorrectly block selling an unrelated
      // profitable good just because some OTHER carried quest happens to be
      // ready to turn in.
      const profitHere = profitIfSoldHere(obs, mem);
      if (profitHere > 0) push("trade", `sell-for-profit:${profitHere}`);
      // Cut a stale loss: a KNOWN profitable margin exists for held cargo
      // (`heldGoods`/`bestHeld` above), but the run has gone too long without
      // a day passing (`daysStagnant`) while stuck at a planet that isn't
      // that margin's sell destination and isn't profitable to sell at
      // either. This fires once nothing else in the ladder can make
      // progress — most commonly once `galaxyEffectivelyLost` (below) is
      // blocking the warp that would actually reach the sell planet, since a
      // safety-driven refusal to travel shouldn't also mean holding
      // unsellable cargo forever. Converts to credits at whatever price this
      // market offers rather than idling on cargo with nowhere safe to go.
      if (
        profitHere <= 0 &&
        daysStagnant &&
        heldGoods.size > 0 &&
        (obs.currentPlanet?.market ?? []).some((m) => heldGoods.has(m.resource))
      )
        push("trade", "cut-stale-loss");
      // Quest cargo — buy the exact remaining amount a carried DELIVERY quest
      // needs, when this planet stocks it and the KNOWN quest reward already
      // covers the cost (see `deliveryCargoNeed`: never speculative, always
      // capped to the shortfall). Ranked above the memory-margin buy-low below
      // — a contractual payout beats a price guess — and evaluated every visit
      // regardless of `daysStagnant`: it buys the shortfall exactly once (the
      // need drops to 0 after), so it can never become a farmed buy/sell loop.
      const questCargoNeed = deliveryCargoNeed(
        obs.quests,
        obs.currentPlanet?.market,
      );
      // Gate on affording at least one unit now: without this, an unaffordable
      // need (profitable on paper against the reward, but pricier than the
      // agent's current wallet) would push this tier forever with the actual
      // trade executor buying zero units every visit — a permanent stall.
      const questCargoPrice =
        questCargoNeed != null
          ? (obs.currentPlanet?.market.find(
              (m) => m.resource === questCargoNeed.good,
            )?.buy ?? Infinity)
          : Infinity;
      if (questCargoNeed && hasHold && credits >= questCargoPrice)
        push("trade", `buy-quest-cargo:${questCargoNeed.good}`);
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
        credits >= buyPrice &&
        !daysStagnant
      ) {
        push("trade", `buy-low:${best.good}`);
      }
      // Earn — take offered work, else inspect the market, else take off.
      // Stops once the Overmind front is too far along (see
      // `QUEST_ACCEPT_OVERMIND_SHARE_CEILING`) — a new multi-warp obligation
      // has no business starting when most of the galaxy is already hostile.
      if (
        (obs.currentPlanet?.availableQuests ?? 0) > 0 &&
        (obs.overmindShare ?? 0) < QUEST_ACCEPT_OVERMIND_SHARE_CEILING
      )
        push("take-quest", "take-work");
      // Skip market re-visit when already holding cargo: would sell at a loss
      // (same-planet sell < buy) and keeps the agent stuck on one planet.
      // Instead fall through to take-off so the agent warps to the sell planet.
      // Also skip once this planet's prices are already in the price book —
      // the observation/memory fold learns a landed planet's market for free
      // before this decision runs, so re-opening TRADE here teaches nothing
      // and only ping-pongs PLANET↔TRADE for a step. Only a `mem` that
      // genuinely hasn't seen this planet yet (a raw/unfolded belief state)
      // still benefits from it.
      const pricesKnownHere =
        (mem.priceBook.get(landedId ?? "")?.size ?? 0) > 0;
      if (mem.inventoryLots.length === 0 && !pricesKnownHere)
        push("trade", "inspect-market");
      push("move", "take-off");
      break;
    }
    case SceneType.SPACE_FLIGHT: {
      // A DELIVERY quest's cargo need already fully bought — committed to the
      // quest's own turn-in, never a market sell (see `deliveryReadyToTurnIn`).
      // Its target planet/system is read below (targetPlanetId preference for
      // `quest-delivery`) — `bestHeld` itself already excludes this good (see
      // `heldGoods`/`questCommittedGoods` above), so realising a sell here
      // needs no separate `readyDelivery` gate of its own.
      const readyDelivery = deliveryReadyToTurnIn(obs.quests);
      // Realise a known sell: holding the good and its sell planet is in-system.
      if (
        bestHeld.good != null &&
        heldQty(mem, bestHeld.good) > 0 &&
        planetInSystem(obs, bestHeld.sellPlanet)
      ) {
        push("land", "go-sell", bestHeld.sellPlanet ?? undefined);
      }
      // Whether the known best margin (if any) can actually be acted on right
      // now. `best` is computed over the WHOLE session's price book, not just
      // this system — a margin whose buy planet is a system left behind isn't
      // "actionable" here at all (warping doesn't undo that), and one whose
      // buy planet IS in this system can still have drifted unaffordable
      // (dynamic pricing rises with repeated buys). Both cases used to read as
      // "there's a real margin" and blocked price-discovery/early-explore
      // below forever: a stale, unreachable cross-system margin from earlier
      // in the run permanently masked "nothing left to do in THIS system",
      // and an in-system-but-unaffordable one kept re-routing the agent back
      // to the same buy planet, landing, discovering it still can't afford
      // it, and taking off. Both stalls were previously masked by the removed
      // blind-buy fallback happening to touch *some* cargo and unstick the
      // holdsNothing gate below.
      const bestBuyIsLocal =
        best.good != null && planetInSystem(obs, best.buyPlanet);
      const bestBuyPrice =
        best.good != null && best.buyPlanet != null
          ? (mem.priceBook.get(best.buyPlanet)?.get(best.good)?.buy ?? Infinity)
          : Infinity;
      const bestBuyAffordable = best.good != null && credits >= bestBuyPrice;
      // Start a known buy: empty hold, the cheap source is in-system, and it's
      // actually affordable right now — but not once `daysStagnant` (see the
      // `MAX_FOLDS_WITHOUT_DAY_ADVANCE` doc comment above `warpCadenceOk`).
      if (
        best.good != null &&
        holdsNothing(mem) &&
        bestBuyIsLocal &&
        bestBuyAffordable &&
        !daysStagnant
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      // Progression — quest delivery: the current system is a carried quest's
      // delivery target AND that quest is actually completable here (no cargo
      // requirement, or the requirement is already met). Landing purely because
      // `obs.questDeliveryHere` (ANY active quest's target, regardless of
      // readiness) matched used to force a "shortfall" no-op land↔take-off loop
      // forever whenever a multi-unit cargo need wasn't fully bought yet —
      // `PlanetScene.checkDeliveryQuestCompletion` just shows a toast and does
      // nothing else, so nothing ever unstuck it. Only land here once there is
      // something to actually resolve; otherwise the ladder falls through to
      // buy/explore tiers that can make real progress toward it. `obs.quests`
      // is empty only in synthetic fixtures that set the flag directly without
      // quest detail (real `observe()` output never has the flag true with an
      // empty list, since it's derived FROM that list) — trust the flag as-is
      // there so those pure-fixture tests keep pinning the flag's behavior.
      const currentSystemId = obs.system?.id ?? null;
      const completableHere = (q: QuestSnapshot) =>
        q.targetSystemId === currentSystemId &&
        (!q.collectItem || q.collectItem.carried >= q.collectItem.required);
      const questDeliveryActionable =
        obs.questDeliveryHere &&
        (obs.quests.length === 0 || obs.quests.some(completableHere));
      if (currentSystemId != null && questDeliveryActionable) {
        const planets = obs.system?.planets ?? [];
        // In-system courier runs («Местный подряд») only complete on their
        // named `targetPlanetId` (`evaluateDelivery` returns `n/a` on any
        // other planet). Landing blindly on the first completable quest's
        // target risks picking a DIFFERENT active DELIVERY quest's target
        // than the one the carried cargo actually satisfies — an
        // oracle-invisible land↔take-off soft-lock (it's a land/move, not a
        // `wait`) at the wrong planet. Prefer `readyDelivery`'s own target
        // (the specific quest the held cargo is committed to) when it names
        // this system; only fall back to the first completable match's
        // target / `planets[0]` otherwise.
        const targetPlanetId =
          readyDelivery?.targetSystemId === currentSystemId
            ? (readyDelivery.targetPlanetId ?? null)
            : (obs.quests.find(
                (q) => completableHere(q) && q.targetPlanetId != null,
              )?.targetPlanetId ?? null);
        const deliveryPlanet =
          targetPlanetId != null && planets.some((p) => p.id === targetPlanetId)
            ? targetPlanetId
            : planets[0]?.id;
        if (deliveryPlanet) push("land", "quest-delivery", deliveryPlanet);
      }
      // Deliberately NOT a dedicated warp toward a ready-to-deliver quest's
      // DIFFERENT-system target: forcing the ship at high priority toward a
      // specific never-visited system (rather than the ladder's own ordinary
      // exploration order) risks an unscouted, possibly-lethal encounter for a
      // reward that's already a bonus on top of the trade loop, not its point
      // (real-engine regression: routing straight at a seed's one dangerous
      // system this way is what killed a full-hull ship in ~5 warp cycles,
      // where the ladder's ordinary exploration never happened to go there).
      // Completion for a cross-system delivery is left fully opportunistic —
      // the in-system `quest-delivery` land tier above fires the moment
      // ordinary exploration/margin-hunting (see `holdingForOtherSystem` and
      // the price-discovery/early-explore tiers below, all now quest-cargo-
      // aware) happens to reach that system on its own.
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
      // Quest-committed cargo doesn't count (see `questCommittedGoods` above) —
      // it has no sell destination to hunt for.
      // Cargo that actually needs a market plan — quest-committed cargo is
      // excluded (see `questCommittedGoods` above): it never blocks the
      // price-discovery/early-explore tiers below the way genuine unsold
      // market cargo does, so the trade loop keeps running (and can still
      // complete a plain sell-for-profit cycle) while a quest is in tow.
      const holdsNonQuestCargo = mem.inventoryLots.some(
        (l) => l.qty > 0 && !questCommittedGoods.has(l.good),
      );
      const holdingForOtherSystem =
        holdsNonQuestCargo &&
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
      if (holdingForOtherSystem && !avoidDanger && explorationSafe) {
        push("warp", "find-sell-destination");
      }
      // No local margin worth pursuing right now — either genuinely no known
      // cross-planet margin, or its buy leg isn't in THIS system, or it is but
      // isn't affordable (see `bestBuyIsLocal`/`bestBuyAffordable` above).
      // Either way, sitting here achieves nothing, so the price-discovery/
      // early-explore tiers below treat it the same as "nothing known" —
      // deliberately NOT gated on `best.fraction` alone, which reflects the
      // whole session's price book and stays nonzero from a stale, no-longer-
      // reachable margin in a system left behind long ago.
      const noActionableMargin = !bestBuyIsLocal || !bestBuyAffordable;
      // Price discovery (empty hold): the nearest earn planet is already known
      // but there's no margin worth acting on — check for a DIFFERENT
      // in-system planet whose prices aren't in the book yet before giving up
      // on this system and blind explore-warping (below). A same-system
      // margin is strictly cheaper to realise than one across a warp, so it's
      // worth one more landing first rather than leaving an unvisited planet
      // behind.
      const undiscoveredPlanet = (obs.system?.planets ?? []).find(
        (p) =>
          p.isHabitable !== false && (mem.priceBook.get(p.id)?.size ?? 0) === 0,
      )?.id;
      if (
        alreadyVisited &&
        noActionableMargin &&
        !holdsNonQuestCargo &&
        !offer &&
        undiscoveredPlanet !== undefined &&
        !daysStagnant
      ) {
        push("land", "discover-prices", undiscoveredPlanet);
      }
      // Early exploration: if the nearest earn planet was already visited this
      // session and there's no margin worth acting on — OR the run has gone
      // too long without a calendar day passing (`daysStagnant`, even with a
      // real local margin still on offer: `land`+`trade` never simulate
      // flight time, so a good-enough margin could otherwise be farmed
      // forever) — warp to explore a NEW system BEFORE landing on the same
      // planet again. This breaks the "visit same planet forever" cycle: the
      // warp fires only after the first visit; a fresh system resets
      // alreadyVisited=false so the agent lands on the new planet first.
      // Positioned before land "earn" so warp wins over the repeated
      // same-planet land when the condition is met.
      if (
        alreadyVisited &&
        (noActionableMargin || daysStagnant) &&
        !avoidDanger &&
        explorationSafe &&
        !holdsNonQuestCargo &&
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
        if (explorationSafe) push("warp", "explore");
      } else {
        if (explorationSafe) push("warp", "explore");
        push("move", "fly");
      }
      break;
    }
    case SceneType.STAR_MAP: {
      // Don't jump toward a remembered threat while not battle-ready.
      if (avoidDanger) push("move", "avoid-danger-back");
      const warpStalled = mem.starMapStallFolds >= MAX_STAR_MAP_WARP_STALLS;
      if (!fuelGate && warpCadenceOk && !warpStalled) push("warp", "warp");
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
      ? pickWarpNeighbor(
          obs.system?.neighbors,
          mem,
          questRoutingPreference(obs.quests, obs.system?.id ?? null),
        )
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
