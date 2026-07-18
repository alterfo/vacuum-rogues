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
 * Minimum ship **capability** (not health) the agent must reach before the
 * Overmind-slayer tier (Task 3) lets it stand and fight garrison ships instead
 * of fleeing them. Distinct from {@link BATTLE_READY_HULL_FRACTION}, which is a
 * *health* fraction (`hull/maxHull`, "am I patched up right now"): these gate on
 * the loadout's *derived* stats (`maxHull`, `weaponDamage`), i.e. "is this ship
 * strong enough to win the fight at all". Both must clear for {@link isBattleReady}.
 *
 * Starter corvette is `maxHull 140` + one pulse laser (`weaponDamage 14`);
 * hostile-system enemies fight at up to 1.5× effective HP/damage
 * (`hostileScaling` lerps toward `OVERMIND_COMBAT_*_MULT` as the ratcheted
 * power grows — three-year-campaign Task 4), so the agent must out-hull them
 * and put out real damage first. `30` needs a second/stronger gun fitted (the
 * corvette ships with a free second weapon slot, so `arm-up` reaches it with
 * one decent buy).
 *
 * The hull floor is `180` — the `hull_freighter` (180 hp, techLevel 4), the
 * best hull a campaign wallet can reliably reach. Task 8 tuning (the plan
 * authorizes moving `BATTLE_READY_*`): the `GearCatalog` has NO hull between
 * 180 and the `hull_warden` (220 hp, techLevel 5), and the next one up
 * (`hull_bastion`, 360 hp) is techLevel 7 — above the `GALAXY_MAX_TECH_FLOOR`
 * (5), so it is never stocked. The warden is tech-5-gated (rare systems) and
 * only ~55% stock-chance even there, so an organic economy without a dedicated
 * "hunt the tech-5 shop" router (Task 9/10 work) can bank the credits but
 * essentially never stands on a warden shop with them — a `200` floor was
 * unreachable-by-catalog and pinned every campaign session below battle-ready
 * (measured: hull peaked at 180 on the strongest seed, weapon at 49, yet
 * `battleReadyDay` fired in 0% of sessions). `180` makes the tech-4 freighter
 * (weight-2 systems, ~65% stock) the battle-ready hull, so the slayer tier
 * actually engages; Task 9's win-rate gate re-tunes if 180 proves too soft
 * against the adaptive garrison scaling.
 */
export const BATTLE_READY_MAX_HULL = 180;
export const BATTLE_READY_WEAPON_DAMAGE = 30;

/**
 * Credits the agent keeps in reserve for trading before it will spend on a
 * military refit (`arm-up`/`upgrade-hull`). Without it, a fresh ship blew its
 * entire ~1000cr starting wallet on the first affordable weapon the instant a
 * shop stocked one — reaching only a second pulse laser (28 damage, short of the
 * 30 threshold) and going broke, unable to fund a single trade, which collapsed
 * the whole economy back into land↔take-off churn (a 100-run diagnostic: 0
 * quests, avg -944cr). The refit is only worthwhile *on top of* a working trade
 * income, so it fires only from genuine surplus — `credits >= cost + reserve` —
 * mirroring the CJM gear-grinder's affordability buffers (`GEAR_GRINDER_*`),
 * which exist for exactly this "don't spend down to zero" reason. Tunable: lower
 * it to let the ship arm up sooner once the economy proves it can rebuild the
 * reserve, raise it to force a longer trading runway first.
 */
export const MILITARY_SPEND_TRADE_RESERVE = 1000;

/**
 * Minimum profit fraction (`BestMargin.fraction`, = margin / sell) a
 * remembered cross-planet margin must clear before the ladder will WARP BACK
 * to farm it (`go-restock`, Task 7). Prices drift between recording and
 * realisation (every buy raises the source price, every sell drops the
 * destination price, and days pass in transit), so a thin margin routinely
 * evaporates into a same-planet loss by arrival — measured: an ungated
 * restock loop turned the 200-day session into 32 trade executions with 19
 * `cut-stale-loss` dumps and a NET LOSS vs. never farming at all. A margin
 * that survives the round trip needs real headroom; anything under this is
 * left as an incidental, single-shot opportunity (`buy-low` while already
 * standing there), never a route.
 */
export const MIN_FARM_MARGIN_FRACTION = 0.25;

/**
 * Whether the ship is combat-capable enough to take on an Overmind garrison —
 * its derived `maxHull` and installed `weaponDamage` both clear the
 * {@link BATTLE_READY_MAX_HULL}/{@link BATTLE_READY_WEAPON_DAMAGE} thresholds.
 * A pure read of the observation; `false` with no player snapshot.
 */
export function isBattleReady(obs: Observation): boolean {
  const p = obs.player;
  if (!p) return false;
  return (
    p.maxHull >= BATTLE_READY_MAX_HULL &&
    (p.weaponDamage ?? 0) >= BATTLE_READY_WEAPON_DAMAGE
  );
}

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
 * How many of a system's habitable planets the agent will land on purely for
 * price discovery / "earn" before it warps to a NEW system instead of hopping
 * to every remaining in-system planet. Two is enough to reveal a same-system
 * margin (cheaper to realise than a cross-warp one) while stopping the visible
 * "land → take-off → land the next planet → take-off …" churn the user sees
 * when a system offers nothing actionable. Quest-offering planets are exempt
 * (landing there is purposeful `take-work`, not aimless discovery).
 */
export const DISCOVERY_LANDINGS_PER_SYSTEM = 2;

/**
 * Consecutive system-changes that land back on a system already in
 * `AgentMemory.recentSystemIds` (F1, live-session finding) above which the
 * slayer-advance tier treats the front as NOT genuinely reachable this tick
 * and stands down. A single-step anti-backtrack (never warp straight back to
 * `previousSystemId`) is not enough to break a hub/triangle topology where
 * `hopsToOvermindFront` ties across 2+ neighbours: a live session bounced
 * sys_22↔14↔23 around a hub 173 times, alternating between the same two
 * "not the immediate previous" neighbours forever. `recentSystemIds` tracks a
 * short multi-step history so the tie-break (`pickFrontwardNeighbor`)
 * de-prioritises anything recently visited, and this streak counter is the
 * backstop for topologies where every neighbour is still in that history.
 */
export const FRONT_CYCLE_STREAK_LIMIT = 3;

/**
 * Trip point for `AgentMemory.warpRejectFolds` — once the SPACE_FLIGHT tier
 * sees this many consecutive star-map round trips return without a system
 * change, it stops emitting the `early-explore` warp and lets the
 * unconditional `earn`-land fallback (the refuel path) win instead. Trips on
 * the very first rejection: a warp that fails once on the engine's absolute
 * per-jump fuel cost will keep failing every retry until the tank is refilled,
 * so there is nothing to gain from tolerating a second failed round trip.
 */
export const MAX_WARP_REJECT_FOLDS = 1;

/**
 * Below this hull fraction, the Overmind-slayer tier (Task 3) breaks off a
 * garrison fight even while battle-ready and standing in a held system —
 * clearing a garrison is the goal, dying in one is not. Above it, a
 * battle-ready ship stands and fights (overriding `flee-outmatched`); at or
 * below it the ordinary survive block's flee/repair sequencing takes back over,
 * so the slayer never trades itself down to a hull loss. Matches the CJM-E
 * goal branch's `OVERMIND_SLAYER_RETREAT_HULL_FRACTION` (same "retreat when
 * genuinely hurt near the core" reasoning); kept as a separate base-ladder
 * constant so the two tiers can diverge under Task 4 tuning without coupling.
 */
export const SLAYER_RETREAT_HULL_FRACTION = 0.4;

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
  "flee-escape-jump",
  "early-explore",
  "explore",
  "warp",
  // Task 7: the active quest-completion warp — `pickWarpNeighbor`'s
  // quest-target routing (direct-neighbour match, else hops-to-target among
  // danger-tied neighbours) is exactly the "toward the KNOWN destination,
  // never through a visible garrison" pick this tier needs.
  "go-deliver",
]);

/**
 * Whether an applier-level `warp` with no pre-picked `targetId` should let
 * quest-target routing bias its destination. Mirrors {@link
 * WARP_TARGETING_REASONS} for actions this policy produced (reason
 * `mem:<reason>`) — a `find-sell-destination` warp deliberately stays blind
 * (see the call site above), so an applier resolving its own fallback target
 * must respect the same exclusion instead of unconditionally biasing toward
 * the quest target. Actions from any other policy (no `mem:` prefix) are left
 * unaffected — they never carried this exclusion.
 */
export function warpWantsQuestBias(reason: string | undefined): boolean {
  if (reason == null || !reason.startsWith("mem:")) return true;
  return WARP_TARGETING_REASONS.has(reason.slice(4));
}

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
      (n) => n.systemId === questTarget && !n.overmindHeld && !n.pirateHeld,
    );
    if (direct) return direct.systemId;
  }
  let bestId: string | undefined;
  let bestDanger = Infinity;
  let bestProgress = Infinity;
  for (const n of neighbors) {
    const danger =
      (n.overmindHeld ? 4 : 0) +
      // A pirate den's standing garrison is as lethal as the Overmind's —
      // and just as visible on the star map (Task 6, orange systems).
      (n.pirateHeld ? 4 : 0) +
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

/**
 * Choose a `warp` destination that walks TOWARD the Overmind front (Task 3) —
 * the mirror image of {@link pickWarpNeighbor}, used only for the battle-ready
 * slayer's `slayer-advance` warp. A neighbour that is itself `overmindHeld` is
 * the front, so it wins outright; otherwise the neighbour with the smallest
 * `hopsToOvermindFront` (multi-source BFS distance to the nearest held system,
 * stamped by `observe()`) wins, breaking ties by `mem.recentSystemIds` — a
 * short rolling history of recently-departed systems (F1, hardened past the
 * single-step `previousSystemId` check: a hub/triangle topology where two or
 * more neighbours tie on hop count can still ping-pong between "not the
 * immediate previous" neighbours forever — a live session bounced
 * sys_22↔14↔23 around a hub 173 times). The most recently visited tied
 * neighbour loses first; a neighbour never visited recently always wins a
 * tie. Returns `undefined` when no neighbour has a known route to the front
 * (no front, or older fixtures without neighbour detail) — the caller then
 * leaves the warp untargeted for the applier.
 */
function pickFrontwardNeighbor(
  neighbors: SystemSnapshot["neighbors"],
  mem: AgentMemory,
): string | undefined {
  if (!neighbors || neighbors.length === 0) return undefined;
  const direct = neighbors.find((n) => n.overmindHeld);
  if (direct) return direct.systemId;
  let bestId: string | undefined;
  let bestHops = Infinity;
  let bestTie = Infinity;
  for (const n of neighbors) {
    const hops = n.hopsToOvermindFront;
    if (hops === undefined) continue;
    const recentIdx = mem.recentSystemIds.indexOf(n.systemId);
    // Not recently visited ⇒ tie 0 (best). Recently visited ⇒ a penalty that
    // grows with recency (index 0 = just departed = the worst tie), so a
    // longer-ago revisit is still preferred over immediately doubling back —
    // and a genuinely fresh neighbour always beats either.
    const tie = recentIdx === -1 ? 0 : mem.recentSystemIds.length - recentIdx;
    if (hops < bestHops || (hops === bestHops && tie < bestTie)) {
      bestHops = hops;
      bestTie = tie;
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
    // Shelter landing first (Task 7): in the compound worst-case WITH a live
    // hostile present, `wait` freezes the galaxy calendar forever (a fight
    // pins the day by design — US-070 #5), so the "diagnostic wait" became an
    // eternal wedge once the campaign horizon actually reached this state
    // (measured: 3181 consecutive deadlock-waits at day 306). Landing is
    // legal even downed, advances in-system days, refuels, and the planet's
    // quest board can lift the no-quest arm — the one world-advancing move
    // left. The bare `wait` remains for fixtures/systems with no planet.
    const shelter = earnPlanetId(obs);
    if (shelter !== undefined && legal.has("land")) {
      return {
        kind: "land",
        reason: "mem:deadlock-shelter",
        targetId: shelter,
      };
    }
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
  // A military refit (arm-up / hull upgrade) is only worthwhile on top of a
  // working trade income — so it fires only when paying for it still leaves the
  // trade-capital reserve intact (`MILITARY_SPEND_TRADE_RESERVE`). Prevents the
  // fresh-ship bankruptcy the arm-up tiers below used to cause.
  const canAffordRefit = (cost: number) =>
    credits - cost >= MILITARY_SPEND_TRADE_RESERVE;

  // 0.5) Overmind-slayer, close-in (Task 3). Two moves that must OUTRANK the
  // survive block below (hence pushed first):
  //  - LIBERATE a garrison-cleared held system — legal only when the current
  //    system is Overmind-held with no hostile ships left, so it is always a
  //    pure, downside-free step toward share 0 (freeing NPC-cleared systems the
  //    ship merely passes through, too). Ungated by battle-ready: the fight is
  //    already over when it becomes legal.
  //  - STAND AND FIGHT a garrison while battle-ready and standing in the held
  //    system — the ONE place `flee-outmatched` is overridden. Gated strictly on
  //    `isBattleReady` AND `overmindHeldHere` (a deliberate liberation mission,
  //    reached only by the advance warp below — ordinary play avoids the front),
  //    so a not-battle-ready ship that stumbles onto a garrison still flees via
  //    the survive block (no death regression). Breaks off below
  //    `SLAYER_RETREAT_HULL_FRACTION` — dropping the `attack` push there lets the
  //    survive block's flee/repair reclaim control before the fight turns lethal.
  const battleReady = isBattleReady(obs);
  const inGarrison = obs.overmindHeldHere === true;
  if (legal.has("liberate")) {
    push("liberate", "slayer-liberate");
  }
  if (
    battleReady &&
    inGarrison &&
    obs.hostiles.length > 0 &&
    hull >= SLAYER_RETREAT_HULL_FRACTION
  ) {
    push("attack", "slayer-clear-garrison", obs.hostiles[0]?.id);
  }

  // Disengage from a fight we're likely to lose. A hostile whose hull HP
  // exceeds our *current* hull will out-trade us: empirically the
  // capture-fleet / Overmind craft carry far more hull than a starter ship
  // and delete it in ~2 combat days (100%→35%→0), so the plain `hurt`
  // (<35% hull) cutoff fires too late — one more combat day after it trips
  // is already lethal. Treat an over-HP'd enemy as a flee-now trigger even
  // at full hull, so the agent never trades blows with a capture fleet.
  // Hoisted above the survive block because the STAR_MAP tier must recompute
  // the SAME flee condition (`fleeingLiveFight` below): the ladder carries no
  // decision history, so "did the survive tier just choose flee" is only
  // knowable by re-deriving it.
  const playerHullHP = obs.player?.hull ?? 0;
  const toughestHostileHull = Math.max(
    0,
    ...obs.hostiles.map((h) => h.hullHP ?? 0),
  );
  const outmatched = toughestHostileHull > playerHullHP;
  // Kill-time calculus (Task 6): the hull-compare above only catches a hostile
  // that ALREADY out-hulls us, which fires one volley too late against an
  // equal-hull ship that simply hits harder — measured on the campaign
  // horizon, a starter (130 hull / 14 dmg) that stands against a 130-hull /
  // 27-dmg pirate loses the trade arithmetic 9-exchanges-to-kill vs
  // 5-to-die, and by the time the hull-compare finally trips (first volley
  // taken) NO exit remains: fleeing post-contact dies to pursuit volleys,
  // fighting on dies to the trade. So compare kill-times BEFORE contact:
  // flee while the fight is still winnable to AVOID, i.e. when the hostiles'
  // total hull × their total volley damage exceeds ours × ours
  // (cross-multiplied `hull/dmg` exchange counts, so zero-damage cases need
  // no division guards: an unarmed hostile can never outgun us, and any
  // armed hostile outguns an unarmed us). Hostile `damage` is optional on
  // the snapshot — absent (pre-Task-6 fixtures) ⇒ 0 ⇒ exactly the old
  // decisions. Battle-ready loadouts (hull ≥ 200, weapon ≥ 30) win this
  // arithmetic against ordinary pirates, so the slayer arc is untouched.
  const totalHostileHull = obs.hostiles.reduce(
    (a, h) => a + (h.hullHP ?? 0),
    0,
  );
  const totalHostileDamage = obs.hostiles.reduce(
    (a, h) => a + (h.damage ?? 0),
    0,
  );
  const playerWeaponDamage = obs.player?.weaponDamage ?? 0;
  const outgunned =
    totalHostileHull * totalHostileDamage > playerHullHP * playerWeaponDamage;

  // A DOWNED ship (GOD floor) can neither FIRE nor HYPERJUMP — the engine
  // blocks both («Корабль повреждён — нужен ремонт»), so fight/flee candidates
  // are dead pushes that ping-pong forever (the day-182 capacity wedge:
  // 150× flee → blocked jump → flee). Skip the combat reaction entirely and
  // let the hurt-tier repair/dock and the ordinary land/trade/wait ladder
  // run — under the GOD floor the ship is unkillable, so waiting out a
  // garrison while the calendar (and the arc) advances is honest play, and
  // repairing above the floor restores every blocked action. Never fires on
  // NORMAL/HARD (`downed` is GOD-only by construction).
  const downed = obs.player?.downed === true;

  // Fuel survival lookup, hoisted ahead of the hostile-reaction tier below
  // (the `push("land", "refuel-critical", ...)` priority push itself stays
  // where it was — see "Fuel survival" further down — this only makes the
  // raw fuel state available to the stagnation escalations above it too; see
  // their comments for why).
  const fuelFraction = obs.player?.fuelFraction ?? 1;
  const fuelCritical = fuelFraction < REFUEL_THRESHOLD;
  const refuelPlanet = (obs.system?.planets ?? []).find(
    (p) => p.isHabitable !== false,
  )?.id;

  // 1) Survive — react to a present threat first, then patch a low hull.
  if (obs.hostiles.length > 0 && !downed) {
    const tid = obs.hostiles[0]?.id;
    if (hurt || outmatched || outgunned) {
      // Live-observed deadlock: `flee`'s live executor routes to a boundary-
      // adjacent point and stops — it never actually leaves the system, so a
      // hostile that lingers in scanner range without closing distance (e.g.
      // PATROLLING, not pursuing) makes this branch re-push `flee` forever
      // with zero progress (confirmed live: `foldsSinceDayAdvance` ran past
      // 300 with the ship parked at the system edge). `foldsSinceDayAdvance`
      // is the existing no-progress signal (see `MAX_FOLDS_WITHOUT_DAY_ADVANCE`
      // above); once a flee-worthy standoff has outlasted it, escalate to an
      // actual hyperjump — `warp` is legal from SPACE_FLIGHT whenever the
      // system has a connection, hostiles or not — instead of repeating the
      // no-op flee route another fold.
      //
      // Fuel-starved standoff (campaign wedge, 2026-07-18): `warp` only ever
      // BURNS fuel — escalating to it while the tank is already critical is a
      // dead push the live engine silently rejects every time (confirmed:
      // `CAMPAIGN-7`/`CAMPAIGN-11` ping-ponged STAR_MAP↔SPACE_FLIGHT for the
      // full 300-fold wedge window, fuel pinned at 0 the whole time, a
      // habitable planet sitting unused in the very same system). `land`
      // needs no fuel and is the one move that actually breaks the standoff
      // (refuels to full), so prefer it over the fuel-blocked jump whenever a
      // habitable planet is available; only fall back to the jump escalation
      // when there is none to land on.
      if (mem.foldsSinceDayAdvance >= MAX_FOLDS_WITHOUT_DAY_ADVANCE) {
        if (fuelCritical && refuelPlanet) {
          push("land", "flee-stagnant-refuel", refuelPlanet);
        } else if (legal.has("warp")) {
          push("warp", "flee-stagnant-jump");
        }
      }
      push(
        "flee",
        outmatched
          ? "flee-outmatched"
          : outgunned
            ? "flee-outgunned"
            : "flee-low-hull",
        tid,
      );
      push("attack", "fight", tid);
    } else {
      // Strategic disengage (campaign win-rate finding, 2026-07-13): every
      // trigger above is TACTICAL (about THIS fight) — nothing here ever
      // asked "am I nowhere near battle-ready and stuck in a no-progress
      // standoff." `NpcShipManager.checkGarrisonAggro` shields a low-power
      // ship from a neutral wanderer's aggro but leaves it `hostile===true`,
      // so it keeps populating `obs.hostiles` without ever closing or firing
      // — `attack` wins this branch every time and the agent parks on it
      // forever (the campaign's own stall telemetry: `repeat=N@SPACE_FLIGHT
      // |attack`, `dayFrozen=N` — confirmed live: a fresh 3-session run today
      // died 0/3, all before day 310, power never exceeding 0.15). Mirrors
      // the tactical branch's own `flee-stagnant-jump` escalation above,
      // gated the same way (`foldsSinceDayAdvance`) so it only fires once a
      // standoff is PROVEN, never against a fresh/winnable fight — a
      // battle-ready ship never reaches this push at all (`!battleReady`),
      // preserving "an ARMED ship is still hunted." Same fuel-starved-standoff
      // fix as the tactical branch above: prefer the fuel-free `land` over a
      // `warp` the engine will just reject.
      if (
        !battleReady &&
        mem.foldsSinceDayAdvance >= MAX_FOLDS_WITHOUT_DAY_ADVANCE
      ) {
        if (fuelCritical && refuelPlanet) {
          push("land", "flee-weak-inert-refuel", refuelPlanet);
        } else if (legal.has("warp")) {
          push("warp", "flee-weak-inert-standoff");
        }
      }
      push("attack", "fight", tid);
      push("flee", "flee", tid);
    }
  }
  // Only chase a repair the wallet can PAY for (Task 6): `executeRepair`
  // no-ops when unaffordable and the STATION legality already prunes it, so
  // pushing dock-to-repair broke just ping-pongs dock→leave→dock while the
  // calendar freezes. Broke-and-hurt falls through to the economy ladder —
  // sell cargo / trade / earn until the bill is coverable. Absent field
  // (pre-Task-6 fixtures) ⇒ affordable, the legacy decisions.
  if (hurt && obs.player?.canAffordRepair !== false) {
    push("repair", "repair-low-hull");
    push("dock", "dock-to-repair", obs.system?.stations[0]?.id);
  }
  // Downed-and-broke rescue (Task 7): a DOWNED ship cannot warp/fight and an
  // unaffordable repair prunes the tier above, so with an empty wallet the
  // ladder used to fall through to earn-landings that earn nothing — the
  // terminal churn of the 200-day GOD probe (600+ land↔take-off steps at
  // 0cr). The game's own exit is the bank: dock and take the standard 5000cr
  // loan (`take-loan` is legal from STATION/BANK), which makes the repair
  // affordable next fold; the STATION repay tier below clears the debt once
  // the economy is running again. Gated on DOWNED so an ordinary broke-but-
  // mobile ship still earns its repair money honestly instead of borrowing.
  // Only while debt-free: with a loan already outstanding a second `take-loan`
  // is illegal, so pushing the dock anyway spun a dock↔leave wedge (measured:
  // 1832 dock-to-loan no-ops at day 255) — an indebted, downed, broke ship
  // falls through to the earn-landing tiers instead (landing is legal while
  // downed, advances the calendar, and slowly rebuilds the repair money).
  if (
    downed &&
    hurt &&
    obs.player?.canAffordRepair === false &&
    (obs.loanBalance ?? 0) === 0
  ) {
    push("take-loan", "loan-for-repair");
    push("dock", "dock-to-loan", obs.system?.stations[0]?.id);
  }

  // Fuel survival — refuel before the tank runs dry. Landing on any habitable
  // planet in-system refuels to full at no fuel cost, so a critical fuel
  // fraction routes there ahead of everything below (trade/progress/explore).
  // `fuelGate` additionally suppresses every `warp` candidate this call could
  // otherwise emit — a warp only ever burns fuel, and burning more while
  // already critical is exactly the stranding this tier exists to prevent.
  // (`fuelFraction`/`fuelCritical`/`refuelPlanet` themselves are hoisted above
  // the hostile-reaction tier — see that block's comment — so this just
  // reuses them and keeps `fuelGate`'s declaration site unchanged.)
  const fuelGate = fuelCritical;
  if (fuelCritical) {
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
  // A battle-ready ship does NOT flee a rising front (Task 8, endgame press):
  // fleeing the Overmind is the WEAK ship's survival reflex — once the loadout
  // can actually take on a garrison, retreating from a hostile-free front just
  // cedes ground the slayer-advance tier below is trying to reclaim, and it
  // trades the whole point of becoming battle-ready (finish the war) for more
  // idle avoidance. A capability-battle-ready ship instead holds and lets the
  // advance/clear/liberate tiers press. The hull-based flee from an ACTUAL
  // fight (the survive block above) is untouched — this only suppresses the
  // no-hostile "the front is scary" pre-emptive retreat.
  const overmindThreatening =
    obs.nearOvermindCore || (obs.overmindShare ?? 0) > OVERMIND_THREAT_SHARE;
  if (
    overmindThreatening &&
    !battleReady &&
    hull < OVERMIND_THREAT_HULL_FRACTION &&
    !fuelGate &&
    obs.hostiles.length === 0
  ) {
    push("warp", "flee-overmind-front");
  }

  // Hoisted above the slayer-advance tier (originally derived further down,
  // alongside `restockSystem`/`go-deliver`) so slayer-advance can itself read
  // `deliverableElsewhere` (F1: don't preempt a loaded, ready delivery for a
  // multi-hop trek to the front). Pure functions of `obs` only — safe to
  // compute this early; still used unchanged at their original call sites.
  const hostileHeld = new Set(obs.hostileSystemIds ?? []);
  const currentSystemId = obs.system?.id ?? null;
  const deliverableElsewhere = obs.quests.some(
    (q) =>
      q.type === QuestType.DELIVERY &&
      q.targetSystemId != null &&
      q.targetSystemId !== currentSystemId &&
      !hostileHeld.has(q.targetSystemId) &&
      (!q.collectItem || q.collectItem.carried >= q.collectItem.required),
  );

  // 1.6) Overmind-slayer, advance (Task 3, hardened Task 16b/F1): a
  // battle-ready ship NOT yet in a garrison, with no local fight and fuel to
  // spare, routes TOWARD the nearest Overmind-held system to go clear it
  // (targeted by `pickFrontwardNeighbor` in the pick block below). Ranked
  // below every survival tier above (present-hostile reaction, low-hull
  // repair, fuel-critical refuel, front-flee) so survival always wins
  // *between* engagements, but above the ordinary trade/earn/explore ladder
  // in the scene switch — once strong enough, finishing the war outranks
  // more trading. Requires a neighbour with a known route to the front
  // (`hopsToOvermindFront`), so it never fires with no arc to fight.
  // Deliberately NOT gated by the anti-consecutive-warp cadence: a committed
  // march to the front shouldn't be interrupted by the generic anti-blind-warp
  // heuristic, exactly like `flee-overmind-front` above.
  //
  // Two live-session findings (F1) hardened this tier:
  //  - `frontCycleOk` — `mem.frontCycleStreak` (see `AgentMemory`) counts
  //    consecutive system-changes that land back on a recently-visited system
  //    (`mem.recentSystemIds`, a short rolling history — not just the single
  //    immediate previous system `pickFrontwardNeighbor` already avoids). A
  //    live session bounced sys_22↔14↔23 around a hub 173 times: every hop
  //    tied on `hopsToOvermindFront` and the single-step anti-backtrack let it
  //    alternate between the same two neighbours forever. Once the streak
  //    crosses `FRONT_CYCLE_STREAK_LIMIT` the front is treated as NOT
  //    genuinely reachable this tick — the ladder falls through to the
  //    ordinary economy/explore tiers below instead of looping.
  //  - `frontAdjacent || !deliverableElsewhere` — a battle-ready ship must not
  //    preempt a loaded, ready-to-turn-in delivery for a multi-hop trek to the
  //    front (measured: a live session sat on 12/12 loaded cargo, 969cr, 3
  //    jumps out, the ENTIRE late game because slayer-advance always won the
  //    tie against `go-deliver`). It MAY still preempt when the front is
  //    genuinely reachable+clearable — i.e. a neighbour is already
  //    Overmind-held, one warp from a fight — since finishing an adjacent
  //    fight is worth more than a detour to deliver.
  const frontReachable = (obs.system?.neighbors ?? []).some(
    (n) => n.hopsToOvermindFront !== undefined,
  );
  const frontAdjacent = (obs.system?.neighbors ?? []).some(
    (n) => n.overmindHeld,
  );
  const frontCycleOk = mem.frontCycleStreak < FRONT_CYCLE_STREAK_LIMIT;
  if (
    battleReady &&
    !inGarrison &&
    obs.hostiles.length === 0 &&
    !fuelGate &&
    frontReachable &&
    frontCycleOk &&
    (frontAdjacent || !deliverableElsewhere)
  ) {
    push("warp", "slayer-advance");
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
  // Danger that lies AHEAD of an exploratory warp, as opposed to the current
  // system's own remembered threat (Task 7). `avoidDanger` folds the CURRENT
  // system's threat in (needed by STAR_MAP's `avoid-danger-back`, whose risk
  // is jumping while this system's hostiles can still intercept mid-transit)
  // — but `threatMap` never decays, so gating the in-flight exploratory warps
  // on it too meant one old scrape in a system permanently pinned any
  // less-than-fully-patched ship THERE: `early-explore`/`find-sell` stayed
  // blocked, the ladder fell through to the unconditional earn-landing, and
  // the run churned land↔take-off in a depleted system for its remaining
  // lifetime while repair fees drained it (the measured 200-day trap: 126
  // consecutive earn/take-off steps, 1207→167cr). Warping AWAY is how a hurt
  // ship in a once-dangerous system gets safer — `pickWarpNeighbor` already
  // ranks remembered-threat/Overmind/pirate neighbours last — so exploratory
  // warps hold back only for (a) a remembered-dangerous DESTINATION (the
  // quest goal, when it's elsewhere) or (b) this system's hostiles being
  // PRESENT right now (a live fight is the survive tier's call, not an
  // invitation to open the star map mid-volley).
  const questGoalSystem = questRoutingPreference(
    obs.quests,
    obs.system?.id ?? null,
  );
  const dangerAhead =
    questGoalSystem != null ? (mem.threatMap.get(questGoalSystem) ?? 0) : 0;
  const dangerHereLive = currentSystemDanger > 0 && obs.hostiles.length > 0;
  const avoidDangerAhead =
    (dangerAhead > 0 || dangerHereLive) && hull < BATTLE_READY_HULL_FRACTION;
  // The survive tier's own flee condition, re-derived for the STAR_MAP tier
  // (hostiles are system-scoped, so a live fight is visible from the map):
  // a fleeing ship is on the map to ESCAPE the current system, and treating
  // its own system's remembered threat as a reason to back out would hand it
  // straight back to the hostile it is fleeing (the campaign calendar wedge).
  const fleeingLiveFight =
    obs.hostiles.length > 0 && !downed && (hurt || outmatched || outgunned);
  // Anti-consecutive-warp cadence — once the run has hopped this many systems
  // in a row without landing, stop emitting `warp` from the base ladder so the
  // remaining candidates (land/dock/wait) get a chance to break the streak.
  // Its main target is the laden agent blind-warping system after system
  // hunting an unknown sell planet, but it deliberately bounds EVERY base-
  // ladder warp (empty holds included) — the real-engine gate in
  // `exploreNoWarpLoop.test.ts` pins that no session ever strings more than
  // the cap of consecutive warps. Any landing resets the tally (see
  // `updateMemory`), so a productive explorer never feels the cap.
  const warpCadenceOk =
    mem.consecutiveWarpsWithoutLanding < MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;
  // No galaxy day has passed in too long — `land`/`trade` are both free in
  // time, so a good local margin can be farmed forever otherwise. Once
  // tripped, the ladder stops STARTING new buy cycles (existing cargo can
  // still be sold off) so the agent is forced back toward earn/explore/warp,
  // which are what actually advance the calendar.
  const daysStagnant =
    mem.foldsSinceDayAdvance >= MAX_FOLDS_WITHOUT_DAY_ADVANCE;

  // Margin farming (Task 7): with an EMPTY hold and a known, affordable
  // cross-planet margin whose buy planet lives in a remembered OTHER system,
  // warp back toward that system to restock. Without this the ladder could
  // only ever act on a margin whose buy leg happened to be in the current
  // system (`go-buy`) — after one sell it had no route back, so the A-buy →
  // B-sell loop a human farms was structurally impossible and every
  // remaining warp was speculative exploration (measured on the 200-day
  // horizon: ONE profitable sale in the whole session). The remembered
  // system must be threat-clean; hop routing toward it is the applier's
  // destination resolution (a non-adjacent `targetId`), exactly like the
  // quest bias. Derived here because BOTH the flight tier and the STAR_MAP
  // tier (the second half of the two-step warp) need to re-derive the same
  // intent — the ladder carries no decision history.
  // No routed trip ever targets a hostile-held system (Task 7): the threatMap
  // below is ship-scoped memory (a far-off capture is never in it), while the
  // real star map shows every captured system galaxy-wide — a remembered
  // destination the spread front swallowed since the last visit must be
  // refused HERE, not discovered by flying into its garrison (the measured
  // day-255 pinned-at-the-front wedge). See `Observation.hostileSystemIds`
  // (`hostileHeld` itself is now hoisted above the slayer-advance tier).
  const restockBuyPrice =
    best.good != null && best.buyPlanet != null
      ? (mem.priceBook.get(best.buyPlanet)?.get(best.good)?.buy ?? Infinity)
      : Infinity;
  const restockCandidate =
    best.good != null &&
    best.buyPlanet != null &&
    best.fraction >= MIN_FARM_MARGIN_FRACTION &&
    holdsNothing(mem) &&
    credits >= restockBuyPrice
      ? (mem.planetSystems.get(best.buyPlanet) ?? null)
      : null;
  const restockSystem =
    restockCandidate != null &&
    restockCandidate !== (obs.system?.id ?? null) &&
    (mem.threatMap.get(restockCandidate) ?? 0) === 0 &&
    !hostileHeld.has(restockCandidate)
      ? restockCandidate
      : null;

  // Cargo that actually needs a market plan — quest-committed cargo is
  // excluded (see `questCommittedGoods` above): it never blocks the
  // price-discovery/early-explore tiers the way genuine unsold market cargo
  // does, so the trade loop keeps running (and can still complete a plain
  // sell-for-profit cycle) while a quest is in tow. Hoisted above the scene
  // switch (Task 7) because the STAR_MAP tier needs the same signals to
  // finish a sell route's two-step warp.
  const holdsNonQuestCargo = mem.inventoryLots.some(
    (l) => l.qty > 0 && !questCommittedGoods.has(l.good),
  );
  const holdingForOtherSystem =
    holdsNonQuestCargo &&
    (bestHeld.sellPlanet === null || !planetInSystem(obs, bestHeld.sellPlanet));
  // The remembered SYSTEM of the held cargo's best sell planet (Task 7) —
  // lets the sell leg warp TOWARD its destination instead of the old blind
  // explore-wander, which routinely never reached the sell planet at all, so
  // the remembered sell price was never refreshed and a stale margin could
  // zombie-walk the run (buy at A → wander → `cut-stale-loss` dump at C →
  // repeat). `undefined` when the planet's system was never seen.
  const sellRouteSystemSeen =
    bestHeld.sellPlanet != null
      ? (mem.planetSystems.get(bestHeld.sellPlanet) ?? undefined)
      : undefined;
  // A captured sell destination degrades to the blind explore-wander (the
  // held cargo still needs SOME market), never a routed trip into a garrison.
  const sellRouteSystem =
    sellRouteSystemSeen != null && hostileHeld.has(sellRouteSystemSeen)
      ? undefined
      : sellRouteSystemSeen;

  // `currentSystemId`/`deliverableElsewhere` (the `go-deliver` warp's
  // condition — the flight tier AND the STAR_MAP tier's two-step warp both
  // need it, and now so does the slayer-advance tier above) are hoisted
  // above the slayer-advance tier; still in scope here unchanged.
  // Directed quest-cargo sourcing (Task 7): an active DELIVERY quest with an
  // UNMET cargo need used to wait for the agent to *stumble* onto a planet
  // stocking the good (measured: accept ≈ day 40, cargo found ≈ day 70 — the
  // collect phase dominated the ~60-day quest cycle). When a remembered
  // planet in a threat-clean OTHER system sells the good at an affordable
  // price, warp toward that system instead of wandering. The PLANET tier's
  // `buy-quest-cargo` (exact-shortfall, reward-covered — see
  // `deliveryCargoNeed`) still owns the actual purchase on arrival.
  const unmetQuest = obs.quests.find(
    (q) =>
      q.type === QuestType.DELIVERY &&
      q.collectItem != null &&
      q.collectItem.carried < q.collectItem.required,
  );
  const unmetNeed = unmetQuest?.collectItem;
  // Fires only with the wallet covering the WHOLE remaining shortfall (a
  // partial chase strands the run mid-collection with no funds to finish)
  // and no unsold market cargo in tow (sell that first — the sell leg both
  // funds this buy and is already a routed trip of its own). The remembered
  // price must ALSO clear the buy tier's own reward-covered rule
  // (`deliveryCargoNeed`: `buy × need < reward`) — otherwise this warp flies
  // to a stockist whose purchase the PLANET tier will refuse on arrival (the
  // measured go-stock×6-yet-0/9 loop of the 200-day probe).
  let stockSystem: string | null = null;
  if (unmetNeed && !holdsNonQuestCargo) {
    const shortfall = unmetNeed.required - unmetNeed.carried;
    const reward = unmetQuest?.rewardCredits ?? 0;
    for (const [planetId, goods] of mem.priceBook) {
      const rec = goods.get(unmetNeed.type);
      if (!rec || rec.buy <= 0 || credits < rec.buy * shortfall) continue;
      if (rec.buy * shortfall >= reward) continue;
      const sys = mem.planetSystems.get(planetId);
      if (sys == null || sys === currentSystemId) continue;
      if ((mem.threatMap.get(sys) ?? 0) > 0) continue;
      if (hostileHeld.has(sys)) continue;
      stockSystem = sys;
      break;
    }
  }
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
        // Thin margins evaporate in transit (see MIN_FARM_MARGIN_FRACTION):
        // starting a buy cycle on one routinely ends in a `cut-stale-loss`
        // dump — measured NET NEGATIVE over the 200-day horizon (Task 7).
        best.fraction >= MIN_FARM_MARGIN_FRACTION &&
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
      // Endgame press (Task 8, hysteresis): a BATTLE-READY ship in an engaged
      // galaxy also stops taking new courier work — once the loadout can fight
      // the war, a multi-warp trade obligation is exactly the "drift back to
      // trading with 2 systems left" the plan wants suppressed. The economy has
      // already funded the refit; from here the slayer tiers own the ship's
      // time, so it doesn't yo-yo between a delivery run and the front.
      const engagedFront = (obs.overmindShare ?? 0) > OVERMIND_THREAT_SHARE;
      if (
        (obs.currentPlanet?.availableQuests ?? 0) > 0 &&
        (obs.overmindShare ?? 0) < QUEST_ACCEPT_OVERMIND_SHARE_CEILING &&
        !(battleReady && engagedFront)
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
      // Military progression (Task 2): the planet's Верфь is a refit shop, so
      // spend spare credits on combat strength before taking off rather than
      // leaving an already-priced, nothing-to-trade planet empty-handed. Ranked
      // below the sell/quest/buy tiers above (the earners that fund the refit)
      // and above `take-off`: arm up first (cheap firepower), then trade up the
      // hull — both feed `isBattleReady`, gated off each once its half is met.
      if (!isBattleReady(obs)) {
        if (
          legal.has("arm-up") &&
          (obs.player?.weaponDamage ?? 0) < BATTLE_READY_WEAPON_DAMAGE &&
          canAffordRefit(obs.armUpCost ?? 0)
        ) {
          push("arm-up", "arm-up");
        }
        // Executor-truth price (Task 7, same as the STATION tier): the reserve
        // is checked against the PRICIEST affordable improving hull —
        // exactly what `executeUpgradeHull` will spend. Legacy fixtures
        // without the field fall back to `bestHullPrice`.
        const hullSpend = obs.upgradeHullCost ?? obs.bestHullPrice ?? null;
        if (
          (obs.player?.maxHull ?? 0) < BATTLE_READY_MAX_HULL &&
          hullSpend != null &&
          canAffordRefit(hullSpend)
        ) {
          push("upgrade-hull", "afford-hull-upgrade");
        }
      }
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
      // Ranked ABOVE starting a new speculative buy (`go-buy` below, Task 7):
      // a contractual, deadlined payout beats opening a fresh trade cycle.
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
      // Active quest completion (Task 7): a carried DELIVERY quest that is
      // COMPLETABLE (no cargo requirement, or the requirement fully bought)
      // but targets ANOTHER system gets a dedicated warp toward it. This
      // replaces the old fully-opportunistic stance ("wait until exploration
      // happens to pass the target"), which on the campaign horizon completed
      // ~1 quest per 200 days while every other accepted contract expired
      // («Срок вышел» rep damage) — quest payouts are the income that funds
      // the battle-ready refit, so leaving them to luck starves the whole
      // military ladder. The lethal-detour regression that motivated the old
      // stance is closed by three later guards: quest boards no longer issue
      // targets in hostile-held systems at all (`BoardOptions.hostileSystems`,
      // Task 6), the `go-deliver` reason is in `WARP_TARGETING_REASONS` so
      // `pickWarpNeighbor` routes by hops-to-target while STILL ranking
      // Overmind/pirate/remembered-threat neighbours last, and the pre-contact
      // kill-time flee (`flee-outgunned`) exits a surprise fight before the
      // first volley trade. Gated on `avoidDangerAhead` (a remembered-
      // dangerous TARGET still holds the ship back while hurt) and
      // `explorationSafe` (fuel / warp cadence / galaxy-lost). Ranked above
      // `go-buy`/`go-restock` for the same deadline-beats-speculation reason
      // as the in-system tier above.
      if (deliverableElsewhere && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-deliver");
      }
      // Source the active quest's unmet cargo need from a remembered
      // stockist (Task 7, see `stockSystem` above) — deadline work beats
      // opening a new speculative buy below.
      if (stockSystem != null && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-stock", stockSystem);
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
        // Same thin-margin gate as `buy-low` — don't even fly to the source
        // for a spread that won't survive the round trip (Task 7).
        best.fraction >= MIN_FARM_MARGIN_FRACTION &&
        holdsNothing(mem) &&
        bestBuyIsLocal &&
        bestBuyAffordable &&
        !daysStagnant
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      // Margin farming (Task 7, see `restockSystem` above): head back to the
      // remembered cheap-buy system. Below `go-deliver` (a contractual
      // payout with a deadline beats a price spread) and above the
      // upgrade/discovery/exploration tiers (a KNOWN margin beats a guess).
      if (restockSystem != null && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-restock", restockSystem);
      }
      // Pursue an affordable upgrade: route to the offer's in-system location.
      if (offer && canAffordOffer) {
        if (planetInSystem(obs, offer.location))
          push("land", "go-upgrade", offer.location);
        else if (stationInSystem(obs, offer.location))
          push("dock", "go-upgrade", offer.location);
      }
      // Military progression (Task 2): not yet battle-ready and an in-system
      // station can actually refit the ship right now — a hull upgrade is
      // affordable, or a weapon refit would raise firepower (`canArmUp`). Dock
      // to build combat strength before the slayer tier (Task 3) sends it at
      // the Overmind front. Gated on a concrete, affordable improvement so it
      // never docks to a no-op; ranked below trade-realisation/quest tiers (the
      // earners that fund the refit) but above generic earn/explore, so a ship
      // sitting on spare credits arms up instead of aimlessly hopping.
      if (!isBattleReady(obs)) {
        const refitStation = obs.system?.stations[0]?.id;
        // Executor-truth price (Task 7): must match the STATION tier's own
        // `upgrade-hull` gate exactly, or the dock is a no-op ping-pong (dock,
        // find the buy refused, leave, re-dock). Legacy-fixture fallback as
        // in that tier.
        const dockHullSpend = obs.upgradeHullCost ?? obs.bestHullPrice ?? null;
        const canAffordHull =
          dockHullSpend != null && canAffordRefit(dockHullSpend);
        const wantsArm =
          (obs.player?.weaponDamage ?? 0) < BATTLE_READY_WEAPON_DAMAGE &&
          obs.canArmUp === true &&
          canAffordRefit(obs.armUpCost ?? 0);
        if (refitStation && (canAffordHull || wantsArm)) {
          push("dock", "go-battle-ready", refitStation);
        }
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
      // Whether every habitable planet in THIS system has been priced — landing
      // on each is *productive* (its market prices + its quest board), so the
      // agent works through all of them before moving on. Replaces the old fixed
      // cap of `DISCOVERY_LANDINGS_PER_SYSTEM`: generation guarantees only ONE
      // habitable planet per system, so a cap of 2 could never be reached there
      // and the ladder kept re-landing on that single already-priced,
      // quest-less planet forever (the land↔take-off churn). Basing "explored"
      // on the real habitable count graduates a 1-planet system after its one
      // productive landing, and lets a richer system be fully worked (more
      // quests/prices seen) rather than abandoned after two.
      const visitedInSystem = (obs.system?.planets ?? []).filter(
        (p) =>
          p.isHabitable !== false && (mem.priceBook.get(p.id)?.size ?? 0) > 0,
      ).length;
      const systemExploredEnough =
        visitedInSystem >= DISCOVERY_LANDINGS_PER_SYSTEM;
      // Warp to find the sell destination when:
      //  - holding cargo AND best sell planet not in this system, OR
      //  - holding cargo AND no sell planet known (priceBook only covers this system)
      // Both cases need exploration; the second is the early-game cycle-breaker.
      // Quest-committed cargo doesn't count (see `questCommittedGoods` /
      // `holdsNonQuestCargo`/`holdingForOtherSystem`, hoisted above the scene
      // switch) — it has no sell destination to hunt for.
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
      if (holdingForOtherSystem && !avoidDangerAhead && explorationSafe) {
        // Targeted when the sell planet's system is remembered (the applier
        // hop-routes toward a non-adjacent targetId); blind exploration only
        // when no sell destination is known yet (the early-game case).
        push("warp", "find-sell-destination", sellRouteSystem);
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
        !systemExploredEnough &&
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
      // same-planet land when the condition is met — EXCEPT once
      // `warpRejectFolds` has tripped (see its doc + `MAX_WARP_REJECT_FOLDS`):
      // a warp that just got rejected on the engine's absolute per-jump fuel
      // cost will keep getting rejected, so retrying it here instead of
      // falling through to the `earn`-land refuel below would fly/stall
      // forever without ever refuelling.
      const warpRejectTripped = mem.warpRejectFolds >= MAX_WARP_REJECT_FOLDS;
      if (
        (alreadyVisited || systemExploredEnough) &&
        (noActionableMargin || daysStagnant) &&
        !avoidDangerAhead &&
        explorationSafe &&
        !holdsNonQuestCargo &&
        !offer &&
        !warpRejectTripped
      ) {
        push("warp", "early-explore");
      }
      // Stagnation wait (Task 6): the calendar is frozen (12+ folds without a
      // day) and the escape valve above (`early-explore` warp) either didn't
      // fire or is illegal — a DOWNED ship can't warp at all, and land/trade
      // never advance time, so re-landing "to earn" just spins the same
      // day forever (the day-190 capacity wedge: 150× land(earn)→take-off
      // with every buy blocked by this very `daysStagnant` gate). WAIT is the
      // one always-legal move that advances the world: days pass, markets
      // and quest boards refresh, `foldsSinceDayAdvance` resets, and the
      // ladder gets its agency back. Pushed above the earn-landing ONLY while
      // stagnant, so healthy sessions never see it.
      if (daysStagnant) {
        push("wait", "stagnation-wait");
      }
      // Land to "earn" — kept as a fallback so the agent always has a forward
      // move here even when every warp is gated (fuel/cadence/danger/
      // galaxy-lost) or `early-explore` is withheld because
      // `warpRejectTripped`. This is ALSO the refuel path (landing tops the
      // tank) and the break-out from a warp that keeps getting rejected on the
      // engine's absolute per-jump fuel cost.
      // Suppressed once landing here is provably pointless (win-rate-100pct
      // plan): traced 648/651 landings (99.5%) over 1500 steps producing ZERO
      // net credit change — `earnPlanetId`'s fallback to `habitable[0]` lands
      // even with no quest on offer, and once `overmindShare` clears
      // `QUEST_ACCEPT_OVERMIND_SHARE_CEILING` (the same threshold `take-quest`
      // above already gates on), new quests are permanently disabled for the
      // rest of the run — so a landing that ALSO has nothing left to teach
      // the price book (`alreadyVisited`) has no quest upside and no
      // price-discovery upside either. Critical-fuel refuelling is unaffected
      // (handled earlier, unconditionally, by the `refuel-critical` push
      // above) — this only removes the no-op opportunistic top-off, freeing
      // the ladder to fall through to `early-explore`/the move-fly fallback
      // below instead.
      const questsStructurallyUnavailable =
        (obs.overmindShare ?? 0) >= QUEST_ACCEPT_OVERMIND_SHARE_CEILING;
      if (
        earnPlanet !== undefined &&
        !(questsStructurallyUnavailable && alreadyVisited)
      ) {
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
      const warpStalled = mem.starMapStallFolds >= MAX_STAR_MAP_WARP_STALLS;
      // Escape jump — a ship whose survive tier just chose `flee` came HERE
      // to leave the current system: `avoid-danger-back` (tripped by that
      // same system's remembered threat) would return it to the hostile it
      // is fleeing, re-triggering `flee` — a two-scene ping-pong that froze
      // the calendar indefinitely (Task 6 campaign wedge: 8000 straight
      // steps stuck on day 94). While the flee condition holds the jump
      // outranks the back-out and — like `flee-overmind-front` — overrides
      // the anti-consecutive-warp cadence (escape > loop prevention). It is
      // deliberately NOT gated on `warpRejectFolds`: that counter conflates
      // engine-rejected jumps with DELIBERATE map back-outs and only resets
      // on a landing or a system change, so a ship that reaches a standoff
      // after a long no-landing stretch arrives with the counter poisoned —
      // gating on it silently re-created the exact back-out wedge this jump
      // exists to break (measured: zero escape attempts across a 460-step
      // GOD-mode wedge). A genuinely un-jumpable corner (absolute per-jump
      // fuel cost exceeding the tank) is the campaign runner's wedge
      // detector's job to end, not this tier's to predict. Still never fires
      // fuel-critical (the refuel tier owns an empty tank) or on a visibly
      // stalled map.
      const escapeJump = fleeingLiveFight && !fuelGate && !warpStalled;
      if (escapeJump) push("warp", "flee-escape-jump");
      if (!fuelGate && warpCadenceOk && !warpStalled) {
        // Second half of a `go-deliver`/`find-sell-destination`/`go-stock`/
        // `go-restock` two-step (Task 7): the flight tier's intent doesn't
        // survive the map hop (no decision history), so the same conditions
        // re-derive it here, in the same priority order — deadline delivery
        // first, then the sell leg, then restocking. Ranked ABOVE
        // `avoid-danger-back`: each targeted warp carries its own
        // `avoidDangerAhead` gate (remembered-dangerous DESTINATION, or live
        // hostiles HERE that could intercept mid-transit), and the flight
        // tier only opened the map because those gates passed — letting the
        // broader `avoidDanger` (this system's own never-decaying threatMap
        // entry) veto the jump here spun the measured d226 wedge: 1907
        // go-stock map-opens each bounced straight back by
        // avoid-danger-back, zero days advanced.
        if (deliverableElsewhere && !avoidDangerAhead) {
          push("warp", "go-deliver");
        }
        // No `sellRouteSystem !== undefined` gate here (unlike the other
        // three re-derivations below): the flight tier's own push (see the
        // SPACE_FLIGHT case) fires this SAME intent — deliberately blind
        // (`targetId` undefined) when the sell planet's system was never
        // seen, per its own comment. Requiring a known target here broke that
        // parity for the blind case specifically: `avoidDanger` (this
        // system's own remembered threat) plus a blind held-cargo hold used
        // to fall straight through to `avoid-danger-back` below, bouncing
        // back to SPACE_FLIGHT, which immediately re-opens the map with the
        // identical blind intent — a two-scene ping-pong that froze the
        // calendar indefinitely (measured: seed CAMPAIGN-1, 2000+ consecutive
        // `move avoid-danger-back` / `warp find-sell-destination` steps, zero
        // days advanced). Matching the flight tier's own gate exactly lets
        // this win over `avoid-danger-back` (its whole purpose, per the
        // comment above) even blind.
        if (holdingForOtherSystem && !avoidDangerAhead) {
          push("warp", "find-sell-destination", sellRouteSystem);
        }
        if (stockSystem != null && !avoidDangerAhead) {
          push("warp", "go-stock", stockSystem);
        }
        if (
          questGoalSystem == null &&
          restockSystem != null &&
          !avoidDangerAhead
        ) {
          push("warp", "go-restock", restockSystem);
        }
      }
      // Don't jump toward a remembered threat while not battle-ready — the
      // GENERIC exploratory jump below has no destination gate of its own,
      // so the remembered-threat back-out still protects it.
      if (avoidDanger && !escapeJump) push("move", "avoid-danger-back");
      if (!fuelGate && warpCadenceOk && !warpStalled) {
        push("warp", "warp");
      }
      push("move", "back");
      break;
    }
    case SceneType.STATION: {
      // Debt service first (Task 7): once the wallet covers the FULL balance
      // plus the trading reserve, clear the loan-for-repair rescue's debt so
      // interest/arrears stop accruing. Fires only from genuine surplus —
      // `executeRepayLoan` pays `min(owed, credits)`, so gating on
      // balance + reserve keeps it a full repayment that still leaves the
      // economy funded, never a wallet-zeroing trickle.
      if (
        legal.has("repay-loan") &&
        (obs.loanBalance ?? 0) > 0 &&
        credits >= (obs.loanBalance ?? 0) + MILITARY_SPEND_TRADE_RESERVE
      ) {
        push("repay-loan", "repay-loan-surplus");
      }
      // Progression — affordable upgrade: buy it now rather than idling with
      // spare credits. Reuses the CJM-B gear-grinder's affordability buffers
      // (same "don't spend down to exactly zero" reasoning) so the goal-less
      // ladder and that goal branch agree on when an upgrade is "worth it".
      // Military progression (Task 2): while the ship still lacks the firepower
      // half of battle-ready, arm up first — a weapon buy+install is cheap and
      // directly raises `weaponDamage`, and the corvette's free second weapon
      // slot makes it the fastest lever toward the slayer tier. Gated off once
      // weapon-ready so the ladder switches to saving for the hull upgrade.
      if (
        legal.has("arm-up") &&
        (obs.player?.weaponDamage ?? 0) < BATTLE_READY_WEAPON_DAMAGE &&
        canAffordRefit(obs.armUpCost ?? 0)
      ) {
        push("arm-up", "arm-up");
      }
      // Executor-truth price (Task 7): `executeUpgradeHull` buys the PRICIEST
      // affordable improving hull, so the reserve is checked against exactly
      // that spend (`upgradeHullCost`), not the cheapest improving listing.
      // Fixtures that predate the field fall back to `bestHullPrice` (their
      // exact legacy decision).
      const hullSpend = obs.upgradeHullCost ?? obs.bestHullPrice ?? null;
      if (hullSpend != null && canAffordRefit(hullSpend)) {
        push("upgrade-hull", "afford-hull-upgrade");
      }
      // Discretionary shopping only on a healthy hull (Task 7): a HURT ship
      // at a station spends on the repair first — measured blowup: the
      // loan-for-repair rescue's 5000cr got spent on three gear buys while
      // the hull sat at the GOD floor, and the re-broke ship deadlocked. The
      // `hurt` survive tier already pushes `repair` above the scene ladder;
      // this keeps the shopping tiers from competing with it for the wallet.
      // Three more campaign-horizon rules (all measured on the 200-day probe):
      //  - DEBT FREEZE: no discretionary shopping while a loan is outstanding
      //    (the day-184 blowup: the 5000cr repair loan was spent on gear two
      //    folds after it was taken; repay first — see `repay-loan-surplus`).
      //  - EXECUTOR-TRUTH PRICE: the gate weighs `buyGearCost` — what
      //    `executeBuyBestGear` (priciest affordable) will actually spend —
      //    not `cheapestGearPrice`; the mismatch let one "affordable" step
      //    spend 3179cr against a ~980cr check.
      //  - RESERVE: the spend must leave the trade reserve intact
      //    (`canAffordRefit`, the same rule the arm-up/hull tiers obey) — the
      //    old buffer-only gate walked the wallet from its 5171cr peak to 0.
      //  - HULL FIRST: no discretionary gear/module shopping until the ship
      //    is battle-ready — the 220-HP hull that completes battle-ready costs
      //    ~7000cr and the campaign wallet peaks near 6700cr between combat
      //    repairs, so every pre-battle-ready gear buy (non-hull gear feeds
      //    NEITHER battle-ready threshold) pushes the one purchase the whole
      //    military ladder waits on out of reach for another ~100 days.
      const debtFree = (obs.loanBalance ?? 0) === 0;
      // Legacy fixtures without the executor-truth fields fall back to the
      // cheapest-listing price (gear) / a bare reserve check (module).
      const gearSpend = obs.buyGearCost ?? obs.cheapestGearPrice ?? null;
      if (
        !hurt &&
        debtFree &&
        isBattleReady(obs) &&
        gearSpend != null &&
        credits >= gearSpend * GEAR_GRINDER_GEAR_BUFFER &&
        canAffordRefit(gearSpend)
      ) {
        push("buy-gear", "afford-gear");
      }
      const moduleSpend = obs.buyModuleCost ?? 0;
      if (
        !hurt &&
        debtFree &&
        isBattleReady(obs) &&
        obs.hasCraftCenter &&
        canAffordRefit(moduleSpend)
      ) {
        push("buy-module", "afford-module");
      }
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
  // A `slayer-advance` warp routes the OPPOSITE way — toward the front, not away
  // from it — so it takes its own frontward picker rather than the Overmind-
  // avoiding `pickWarpNeighbor` used by the threat/explore reasons.
  const targetId =
    pick.kind === "warp" && pick.targetId === undefined
      ? pick.reason === "slayer-advance"
        ? pickFrontwardNeighbor(obs.system?.neighbors, mem)
        : WARP_TARGETING_REASONS.has(pick.reason)
          ? pickWarpNeighbor(
              obs.system?.neighbors,
              mem,
              questRoutingPreference(obs.quests, obs.system?.id ?? null),
            )
          : pick.targetId
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
