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

export const BATTLE_READY_HULL_FRACTION = 0.99;

export const BATTLE_READY_MAX_HULL = 180;
export const BATTLE_READY_WEAPON_DAMAGE = 30;

export const MILITARY_SPEND_TRADE_RESERVE = 1000;

export const REFIT_WARCHEST = 6000;

export const MIN_FARM_MARGIN_FRACTION = 0.25;

export function isBattleReady(obs: Observation): boolean {
  const p = obs.player;
  if (!p) return false;
  return (
    p.maxHull >= BATTLE_READY_MAX_HULL &&
    (p.weaponDamage ?? 0) >= BATTLE_READY_WEAPON_DAMAGE
  );
}

export const REFUEL_THRESHOLD = 0.2;

export const MAX_CONSECUTIVE_WARPS_WITHOUT_LAND = 2;

export const MAX_CONSECUTIVE_NOOP_LANDS = 2;

export const MAX_FOLDS_WITHOUT_DAY_ADVANCE = 12;

export const MAX_STAR_MAP_WARP_STALLS = 2;

export const DISCOVERY_LANDINGS_PER_SYSTEM = 2;

export const FRONT_CYCLE_STREAK_LIMIT = 3;

export const MAX_WARP_REJECT_FOLDS = 1;

export const SLAYER_RETREAT_HULL_FRACTION = 0.4;

export const OVERMIND_THREAT_HULL_FRACTION = 0.6;

export const OVERMIND_THREAT_SHARE = 0.15;

export const QUEST_ACCEPT_OVERMIND_SHARE_CEILING = 0.6;

export const OVERMIND_LOSS_SAFETY_MARGIN = 0.05;

const WARP_TARGETING_REASONS = new Set([
  "flee-overmind-front",
  "flee-escape-jump",
  "early-explore",
  "explore",
  "warp",
  "go-deliver",
]);

export function warpWantsQuestBias(reason: string | undefined): boolean {
  if (reason == null || !reason.startsWith("mem:")) return true;
  return WARP_TARGETING_REASONS.has(reason.slice(4));
}

interface Candidate {
  kind: PlayerActionKind;
  targetId?: string;
  reason: string;
}

function heldQty(mem: AgentMemory, good: ResourceType | null): number {
  if (!good) return 0;
  let qty = 0;
  for (const lot of mem.inventoryLots) if (lot.good === good) qty += lot.qty;
  return qty;
}

function holdsNothing(mem: AgentMemory): boolean {
  return mem.inventoryLots.every((l) => l.qty <= 0);
}

function planetInSystem(obs: Observation, planetId: string | null): boolean {
  if (!planetId) return false;
  return (obs.system?.planets ?? []).some((p) => p.id === planetId);
}

function stationInSystem(obs: Observation, stationId: string | null): boolean {
  if (!stationId) return false;
  return (obs.system?.stations ?? []).some((s) => s.id === stationId);
}

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

function pickFrontwardNeighbor(
  neighbors: SystemSnapshot["neighbors"],
  mem: AgentMemory,
): string | undefined {
  if (!neighbors || neighbors.length === 0) return undefined;
  const held = neighbors.filter((n) => n.overmindHeld);
  if (held.length > 0) {
    let best = held[0];
    for (const n of held) {
      if ((n.hopsToCore ?? Infinity) < (best.hopsToCore ?? Infinity)) best = n;
    }
    return best.systemId;
  }
  let bestId: string | undefined;
  let bestHops = Infinity;
  let bestCore = Infinity;
  let bestTie = Infinity;
  for (const n of neighbors) {
    const hops = n.hopsToOvermindFront;
    if (hops === undefined) continue;
    const core = n.hopsToCore ?? Infinity;
    const recentIdx = mem.recentSystemIds.indexOf(n.systemId);
    const tie = recentIdx === -1 ? 0 : mem.recentSystemIds.length - recentIdx;
    if (
      hops < bestHops ||
      (hops === bestHops && core < bestCore) ||
      (hops === bestHops && core === bestCore && tie < bestTie)
    ) {
      bestHops = hops;
      bestCore = core;
      bestTie = tie;
      bestId = n.systemId;
    }
  }
  return bestId;
}

function pickShipyardwardNeighbor(
  neighbors: SystemSnapshot["neighbors"],
  mem: AgentMemory,
): string | undefined {
  if (!neighbors || neighbors.length === 0) return undefined;
  let bestId: string | undefined;
  let bestHops = Infinity;
  let bestTie = Infinity;
  for (const n of neighbors) {
    const hops = n.hopsToShipyard;
    if (hops === undefined || n.overmindHeld) continue;
    const recentIdx = mem.recentSystemIds.indexOf(n.systemId);
    const tie = recentIdx === -1 ? 0 : mem.recentSystemIds.length - recentIdx;
    if (hops < bestHops || (hops === bestHops && tie < bestTie)) {
      bestHops = hops;
      bestTie = tie;
      bestId = n.systemId;
    }
  }
  return bestId;
}

function earnPlanetId(obs: Observation): string | undefined {
  const planets = obs.system?.planets ?? [];
  const habitable = planets.filter((p) => p.isHabitable !== false);
  const withWork = habitable.find((p) => p.availableQuests > 0);
  return (withWork ?? habitable[0])?.id;
}

function cjmAction(
  goal: ScenarioGoal,
  kind: PlayerActionKind,
  detail: string,
  targetId?: string,
): Action {
  return { kind, targetId, reason: `mem:cjm:${goal}:${detail}` };
}

const TRADE_MAGNATE_LOAN_PROFIT_MULTIPLIER = 1.5;
const TRADE_MAGNATE_LOAN_COST_ESTIMATE = 500;

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

const GEAR_GRINDER_HULL_BUFFER = 1.1;
const GEAR_GRINDER_GEAR_BUFFER = 1.2;

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

const BOUNTY_HUNTER_ENGAGE_HULL_FRACTION = 0.5;
const BOUNTY_HUNTER_RETREAT_FLOOR_FRACTION = 0.3;

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

const OVERMIND_SLAYER_RETREAT_HULL_FRACTION = 0.4;
const OVERMIND_SLAYER_ENGAGE_SHARE = 0.1;

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

const PIRATE_ATTACK_HULL_FRACTION = 0.5;

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

const EXPLORER_LOW_CREDITS = 200;

function decideExplorer(
  obs: Observation,
  _mem: AgentMemory,
  legal: Set<PlayerActionKind>,
): Action | null {
  const credits = obs.player?.credits ?? 0;
  const earnPlanet = earnPlanetId(obs);
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
      return null;
  }
}

export function decideWithMemory(
  obs: Observation,
  mem: AgentMemory,
  goal?: ScenarioGoal,
): Action {
  const legal = new Set(obs.legalActions);

  if (detectDeadlock(obs, mem)) {
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
  const canAffordRefit = (cost: number) =>
    credits - cost >= MILITARY_SPEND_TRADE_RESERVE;

  const battleReady = isBattleReady(obs);
  const inGarrison = obs.overmindHeldHere === true;
  if (legal.has("liberate")) {
    push("liberate", "slayer-liberate");
  }
  const playerHullHP = obs.player?.hull ?? 0;
  const toughestHostileHull = Math.max(
    0,
    ...obs.hostiles.map((h) => h.hullHP ?? 0),
  );
  const outmatched = toughestHostileHull > playerHullHP;
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

  if (
    battleReady &&
    inGarrison &&
    obs.hostiles.length > 0 &&
    hull >= SLAYER_RETREAT_HULL_FRACTION &&
    !outgunned
  ) {
    push("attack", "slayer-clear-garrison", obs.hostiles[0]?.id);
  }

  const downed = obs.player?.downed === true;

  const fuelFraction = obs.player?.fuelFraction ?? 1;
  const fuelCritical = fuelFraction < REFUEL_THRESHOLD;
  const refuelPlanet = (obs.system?.planets ?? []).find(
    (p) => p.isHabitable !== false,
  )?.id;

  if (obs.hostiles.length > 0 && !downed) {
    const tid = obs.hostiles[0]?.id;
    if (hurt || outmatched || outgunned) {
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
  if (hurt && obs.player?.canAffordRepair !== false) {
    push("repair", "repair-low-hull");
    push("dock", "dock-to-repair", obs.system?.stations[0]?.id);
  }
  if (
    downed &&
    hurt &&
    obs.player?.canAffordRepair === false &&
    (obs.loanBalance ?? 0) === 0
  ) {
    push("take-loan", "loan-for-repair");
    push("dock", "dock-to-loan", obs.system?.stations[0]?.id);
  }

  const fuelGate = fuelCritical;
  if (fuelCritical) {
    if (refuelPlanet) push("land", "refuel-critical", refuelPlanet);
  }

  const worthinessFloor = battleReady
    ? BATTLE_READY_HULL_FRACTION
    : OVERMIND_THREAT_HULL_FRACTION;
  if (
    hull < worthinessFloor &&
    !obs.nearOvermindCore &&
    obs.hostiles.length === 0 &&
    obs.player?.canAffordRepair !== false
  ) {
    push("repair", "repair-battle-worthiness");
    push("dock", "dock-to-repair", obs.system?.stations[0]?.id);
  }

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

  const frontReachable = (obs.system?.neighbors ?? []).some(
    (n) => n.hopsToOvermindFront !== undefined,
  );
  const frontAdjacent = (obs.system?.neighbors ?? []).some(
    (n) => n.overmindHeld,
  );
  const frontCycleOk = mem.frontCycleStreak < FRONT_CYCLE_STREAK_LIMIT;
  if (
    battleReady &&
    hull >= OVERMIND_THREAT_HULL_FRACTION &&
    !inGarrison &&
    obs.hostiles.length === 0 &&
    !fuelGate &&
    frontReachable &&
    frontCycleOk &&
    (frontAdjacent || !deliverableElsewhere)
  ) {
    push("warp", "slayer-advance");
  }

  const galaxyEffectivelyLost =
    (obs.overmindShare ?? 0) >=
    GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE - OVERMIND_LOSS_SAFETY_MARGIN;

  const best = bestKnownMargin(mem);
  const questCommittedGoods = new Set(
    obs.quests
      .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
      .map((q) => q.collectItem!.type),
  );
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
  const currentSystemDanger = mem.threatMap.get(obs.system?.id ?? "") ?? 0;
  const danger = Math.max(routeDangerToGoal(obs, mem), currentSystemDanger);
  const avoidDanger = danger > 0 && hull < BATTLE_READY_HULL_FRACTION;
  const questGoalSystem = questRoutingPreference(
    obs.quests,
    obs.system?.id ?? null,
  );
  const dangerAhead =
    questGoalSystem != null ? (mem.threatMap.get(questGoalSystem) ?? 0) : 0;
  const dangerHereLive = currentSystemDanger > 0 && obs.hostiles.length > 0;
  const avoidDangerAhead =
    (dangerAhead > 0 || dangerHereLive) && hull < BATTLE_READY_HULL_FRACTION;
  const fleeingLiveFight =
    obs.hostiles.length > 0 && !downed && (hurt || outmatched || outgunned);
  const warpCadenceOk =
    mem.consecutiveWarpsWithoutLanding < MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;
  const daysStagnant =
    mem.foldsSinceDayAdvance >= MAX_FOLDS_WITHOUT_DAY_ADVANCE;

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

  const holdsNonQuestCargo = mem.inventoryLots.some(
    (l) => l.qty > 0 && !questCommittedGoods.has(l.good),
  );
  const holdingForOtherSystem =
    holdsNonQuestCargo &&
    (bestHeld.sellPlanet === null || !planetInSystem(obs, bestHeld.sellPlanet));
  const sellRouteSystemSeen =
    bestHeld.sellPlanet != null
      ? (mem.planetSystems.get(bestHeld.sellPlanet) ?? undefined)
      : undefined;
  const sellRouteSystem =
    sellRouteSystemSeen != null && hostileHeld.has(sellRouteSystemSeen)
      ? undefined
      : sellRouteSystemSeen;

  const unmetQuest = obs.quests.find(
    (q) =>
      q.type === QuestType.DELIVERY &&
      q.collectItem != null &&
      q.collectItem.carried < q.collectItem.required,
  );
  const unmetNeed = unmetQuest?.collectItem;
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
  const explorationSafe = !fuelGate && warpCadenceOk && !galaxyEffectivelyLost;

  const shipyardReachable = (obs.system?.neighbors ?? []).some(
    (n) => n.hopsToShipyard !== undefined,
  );
  if (
    !battleReady &&
    (obs.player?.maxHull ?? 0) < BATTLE_READY_MAX_HULL &&
    credits >= REFIT_WARCHEST &&
    obs.shipyardHere !== true &&
    shipyardReachable &&
    !deliverableElsewhere &&
    !avoidDangerAhead &&
    obs.hostiles.length === 0 &&
    explorationSafe
  ) {
    push("warp", "go-shipyard");
  }

  if (obs.warpInTransit && obs.hostiles.length === 0) {
    return { kind: "wait", reason: "mem:warp-in-transit" };
  }

  if (goal) {
    const goalAction = decideForGoal(goal, obs, mem, legal);
    if (goalAction) return goalAction;
  }

  switch (obs.scene) {
    case SceneType.PLANET: {
      const landedId = obs.currentPlanet?.id ?? null;
      const profitHere = profitIfSoldHere(obs, mem);
      if (profitHere > 0) push("trade", `sell-for-profit:${profitHere}`);
      const stuckSellingHere =
        mem.noopLandPlanetId === landedId &&
        mem.noopLandStreak >= MAX_CONSECUTIVE_NOOP_LANDS;
      if (
        profitHere <= 0 &&
        (daysStagnant || stuckSellingHere) &&
        heldGoods.size > 0 &&
        (obs.currentPlanet?.market ?? []).some((m) => heldGoods.has(m.resource))
      )
        push("trade", "cut-stale-loss");
      const questCargoNeed = deliveryCargoNeed(
        obs.quests,
        obs.currentPlanet?.market,
      );
      const questCargoPrice =
        questCargoNeed != null
          ? (obs.currentPlanet?.market.find(
              (m) => m.resource === questCargoNeed.good,
            )?.buy ?? Infinity)
          : Infinity;
      if (questCargoNeed && hasHold && credits >= questCargoPrice)
        push("trade", `buy-quest-cargo:${questCargoNeed.good}`);
      const buyPrice =
        best.good != null
          ? (obs.currentPlanet?.market.find((m) => m.resource === best.good)
              ?.buy ?? Infinity)
          : Infinity;
      if (
        best.good != null &&
        best.buyPlanet === landedId &&
        best.fraction >= MIN_FARM_MARGIN_FRACTION &&
        holdsNothing(mem) &&
        hasHold &&
        credits >= buyPrice &&
        !daysStagnant
      ) {
        push("trade", `buy-low:${best.good}`);
      }
      const engagedFront = (obs.overmindShare ?? 0) > OVERMIND_THREAT_SHARE;
      if (
        (obs.currentPlanet?.availableQuests ?? 0) > 0 &&
        (obs.overmindShare ?? 0) < QUEST_ACCEPT_OVERMIND_SHARE_CEILING &&
        !(battleReady && engagedFront)
      )
        push("take-quest", "take-work");
      const pricesKnownHere =
        (mem.priceBook.get(landedId ?? "")?.size ?? 0) > 0;
      if (mem.inventoryLots.length === 0 && !pricesKnownHere)
        push("trade", "inspect-market");
      if (!isBattleReady(obs)) {
        if (
          legal.has("arm-up") &&
          (obs.player?.weaponDamage ?? 0) < BATTLE_READY_WEAPON_DAMAGE &&
          canAffordRefit(obs.armUpCost ?? 0)
        ) {
          push("arm-up", "arm-up");
        }
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
      const readyDelivery = deliveryReadyToTurnIn(obs.quests);
      if (
        bestHeld.good != null &&
        heldQty(mem, bestHeld.good) > 0 &&
        planetInSystem(obs, bestHeld.sellPlanet)
      ) {
        push("land", "go-sell", bestHeld.sellPlanet ?? undefined);
      }
      const completableHere = (q: QuestSnapshot) =>
        q.targetSystemId === currentSystemId &&
        (!q.collectItem || q.collectItem.carried >= q.collectItem.required);
      const questDeliveryActionable =
        obs.questDeliveryHere &&
        (obs.quests.length === 0 || obs.quests.some(completableHere));
      if (currentSystemId != null && questDeliveryActionable) {
        const planets = obs.system?.planets ?? [];
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
      if (deliverableElsewhere && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-deliver");
      }
      if (stockSystem != null && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-stock", stockSystem);
      }
      const bestBuyIsLocal =
        best.good != null && planetInSystem(obs, best.buyPlanet);
      const bestBuyPrice =
        best.good != null && best.buyPlanet != null
          ? (mem.priceBook.get(best.buyPlanet)?.get(best.good)?.buy ?? Infinity)
          : Infinity;
      const bestBuyAffordable = best.good != null && credits >= bestBuyPrice;
      if (
        best.good != null &&
        best.fraction >= MIN_FARM_MARGIN_FRACTION &&
        holdsNothing(mem) &&
        bestBuyIsLocal &&
        bestBuyAffordable &&
        !daysStagnant
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      if (restockSystem != null && !avoidDangerAhead && explorationSafe) {
        push("warp", "go-restock", restockSystem);
      }
      if (offer && canAffordOffer) {
        if (planetInSystem(obs, offer.location))
          push("land", "go-upgrade", offer.location);
        else if (stationInSystem(obs, offer.location))
          push("dock", "go-upgrade", offer.location);
      }
      if (!isBattleReady(obs)) {
        const refitStation = obs.system?.stations[0]?.id;
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
      const earnPlanet = earnPlanetId(obs);
      const alreadyVisited =
        earnPlanet !== undefined &&
        (mem.priceBook.get(earnPlanet)?.size ?? 0) > 0;
      const visitedInSystem = (obs.system?.planets ?? []).filter(
        (p) =>
          p.isHabitable !== false && (mem.priceBook.get(p.id)?.size ?? 0) > 0,
      ).length;
      const systemExploredEnough =
        visitedInSystem >= DISCOVERY_LANDINGS_PER_SYSTEM;
      if (
        holdingForOtherSystem &&
        earnPlanet !== undefined &&
        !alreadyVisited
      ) {
        push("land", "discover-prices", earnPlanet);
      }
      if (holdingForOtherSystem && !avoidDangerAhead && explorationSafe) {
        push("warp", "find-sell-destination", sellRouteSystem);
      }
      const noActionableMargin = !bestBuyIsLocal || !bestBuyAffordable;
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
      if (daysStagnant) {
        push("wait", "stagnation-wait");
      }
      const questsStructurallyUnavailable =
        (obs.overmindShare ?? 0) >= QUEST_ACCEPT_OVERMIND_SHARE_CEILING;
      const earnLandCooldownTripped =
        earnPlanet !== undefined &&
        mem.noopLandPlanetId === earnPlanet &&
        mem.noopLandStreak >= MAX_CONSECUTIVE_NOOP_LANDS;
      if (
        earnPlanet !== undefined &&
        !holdsNonQuestCargo &&
        !earnLandCooldownTripped &&
        !(questsStructurallyUnavailable && alreadyVisited)
      ) {
        push("land", "earn", earnPlanet);
      }
      const earnStation = obs.system?.stations[0]?.id;
      const earnDockCooldownTripped =
        earnStation !== undefined &&
        mem.noopDockStationId === earnStation &&
        mem.noopDockStreak >= MAX_CONSECUTIVE_NOOP_LANDS;
      if (!earnDockCooldownTripped) {
        push("dock", "earn", earnStation);
      }
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
      const escapeJump = fleeingLiveFight && !fuelGate && !warpStalled;
      if (escapeJump) push("warp", "flee-escape-jump");
      if (!fuelGate && warpCadenceOk && !warpStalled) {
        if (deliverableElsewhere && !avoidDangerAhead) {
          push("warp", "go-deliver");
        }
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
      if (avoidDanger && !escapeJump) push("move", "avoid-danger-back");
      if (!fuelGate && warpCadenceOk && !warpStalled) {
        push("warp", "warp");
      }
      push("move", "back");
      break;
    }
    case SceneType.STATION: {
      if (
        legal.has("repay-loan") &&
        (obs.loanBalance ?? 0) > 0 &&
        credits >= (obs.loanBalance ?? 0) + MILITARY_SPEND_TRADE_RESERVE
      ) {
        push("repay-loan", "repay-loan-surplus");
      }
      if (
        legal.has("arm-up") &&
        (obs.player?.weaponDamage ?? 0) < BATTLE_READY_WEAPON_DAMAGE &&
        canAffordRefit(obs.armUpCost ?? 0)
      ) {
        push("arm-up", "arm-up");
      }
      const hullSpend = obs.upgradeHullCost ?? obs.bestHullPrice ?? null;
      if (hullSpend != null && canAffordRefit(hullSpend)) {
        push("upgrade-hull", "afford-hull-upgrade");
      }
      const debtFree = (obs.loanBalance ?? 0) === 0;
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
      push("trade", "do-trade");
      push("move", "leave-market");
      break;
    }
    default: {
      push("move", "back");
      break;
    }
  }

  push("wait", "idle"); // universal fallback — always legal.

  const pick = candidates.find((c) => legal.has(c.kind)) ?? {
    kind: "wait" as PlayerActionKind,
    reason: "idle",
  };
  const targetId =
    pick.kind === "warp" && pick.targetId === undefined
      ? pick.reason === "slayer-advance"
        ? pickFrontwardNeighbor(obs.system?.neighbors, mem)
        : pick.reason === "go-shipyard"
          ? pickShipyardwardNeighbor(obs.system?.neighbors, mem)
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

export class MemoryHeuristicPolicy implements PlayerPolicy {
  readonly name = "memory-heuristic";

  private memory: AgentMemory;

  constructor(
    memory?: AgentMemory,
    private readonly goal?: ScenarioGoal,
  ) {
    this.memory = memory ?? createMemory();
  }

  get belief(): AgentMemory {
    return this.memory;
  }

  reset(): void {
    this.memory = createMemory();
  }

  decide(obs: Observation, memory?: AgentMemory): Action {
    if (memory) return decideWithMemory(obs, memory, this.goal);
    this.memory = updateMemory(this.memory, obs);
    return decideWithMemory(obs, this.memory, this.goal);
  }
}
