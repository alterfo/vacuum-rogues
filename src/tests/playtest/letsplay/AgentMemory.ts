import { SceneType, type ResourceType } from "@/types";
import type { Observation } from "./observe";
import { logger } from "@/utils/logger";
import type { GameEngine } from "@/systems/GameEngine";

export interface PriceRecord {
  buy: number;
  sell: number;
  seenAt: number;
}

export interface InventoryLot {
  good: ResourceType;
  qty: number;
  buyPrice: number;
}

export interface KnownOffer {
  item: string;
  price: number;
  location: string;
}

export interface ActiveQuestDelivery {
  questId: string;
  targetSystemId: string;
}

export const DEADLOCK_HULL_FRACTION = 0.1;
export const DEADLOCK_MIN_CREDITS = 100;

export interface AgentMemory {
  priceBook: Map<string, Map<ResourceType, PriceRecord>>;
  inventoryLots: InventoryLot[];
  threatMap: Map<string, number>;
  planetSystems: Map<string, string>;
  knownOffers: KnownOffer[];
  lastCargo: Map<ResourceType, number>;
  step: number;
  visitedSystemIds: Set<string>;
  lastSystemId: string | null;
  lastCurrentPlanetId: string | null;
  previousSystemId: string | null;
  recentSystemIds: string[];
  frontCycleStreak: number;
  consecutiveWarpsWithoutLanding: number;
  loanState?: { balance: number; missedPayments: number };
  deadlockDetected: boolean;
  activeQuestDelivery: ActiveQuestDelivery[];
  creditYesterday: number;
  daysWithoutCreditGain: number;
  overmindDaysSeen: number;
  lastDaySeen: number;
  lastReputationBastions: number;
  lastReputationSyndicate: number;
  lastMaxHull: number;
  foldsSinceDayAdvance: number;
  lastScene: SceneType | null;
  lastFuelSeen: number;
  starMapStallFolds: number;
  completedQuestsBaseline: number;
  warpRejectFolds: number;
  noopLandPlanetId: string | null;
  noopLandStreak: number;
  landedStayProductive: boolean;
  lastQuestCount: number;
  noopDockStationId: string | null;
  noopDockStreak: number;
  lastCreditsSeen: number;
}

export const RECENT_SYSTEM_IDS_MAX = 4;

export function questBaselineForObserve(
  mem: Pick<AgentMemory, "completedQuestsBaseline">,
  engine: GameEngine,
): number {
  return mem.completedQuestsBaseline >= 0
    ? mem.completedQuestsBaseline
    : engine.questManager.getCompletedQuestIds().length;
}

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
    noopDockStationId: null,
    noopDockStreak: 0,
    lastCreditsSeen: 0,
  };
}

function clonePriceBook(
  pb: Map<string, Map<ResourceType, PriceRecord>>,
): Map<string, Map<ResourceType, PriceRecord>> {
  const out = new Map<string, Map<ResourceType, PriceRecord>>();
  for (const [planetId, goods] of pb) out.set(planetId, new Map(goods));
  return out;
}

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

export function updateMemory(mem: AgentMemory, obs: Observation): AgentMemory {
  const step = mem.step + 1;
  const priceBook = clonePriceBook(mem.priceBook);
  const threatMap = new Map(mem.threatMap);
  const planetSystems = new Map(mem.planetSystems);
  const knownOffers = mem.knownOffers.map((o) => ({ ...o }));
  let inventoryLots = mem.inventoryLots.map((l) => ({ ...l }));

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
      noopDockStationId: mem.noopDockStationId,
      noopDockStreak: mem.noopDockStreak,
      lastCreditsSeen: mem.lastCreditsSeen,
    };
  }

  if (obs.currentPlanet) {
    const goods =
      priceBook.get(obs.currentPlanet.id) ??
      new Map<ResourceType, PriceRecord>();
    for (const g of obs.currentPlanet.market) {
      goods.set(g.resource, { buy: g.buy, sell: g.sell, seenAt: step });
    }
    priceBook.set(obs.currentPlanet.id, goods);
  }

  if (obs.system && obs.hostiles.length > 0) {
    const prev = threatMap.get(obs.system.id) ?? 0;
    threatMap.set(obs.system.id, Math.max(prev, obs.hostiles.length));
  }

  if (obs.system) {
    for (const p of obs.system.planets) planetSystems.set(p.id, obs.system.id);
  }

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
      const buyPrice =
        obs.currentPlanet?.market.find((m) => m.resource === good)?.buy ??
        (mem.lastCurrentPlanetId != null
          ? priceBook.get(mem.lastCurrentPlanetId)?.get(good)?.buy
          : undefined) ??
        0;
      inventoryLots.push({ good, qty: after - before, buyPrice });
    } else if (after < before) {
      inventoryLots = consumeLots(inventoryLots, good, before - after);
    }
  }

  const visitedSystemIds = new Set(mem.visitedSystemIds);
  if (obs.system) visitedSystemIds.add(obs.system.id);

  let consecutiveWarpsWithoutLanding = mem.consecutiveWarpsWithoutLanding;
  const systemChanged =
    obs.system !== null &&
    mem.lastSystemId !== null &&
    obs.system.id !== mem.lastSystemId;
  if (obs.currentPlanet || obs.scene === SceneType.STATION) {
    consecutiveWarpsWithoutLanding = 0;
  } else if (systemChanged) {
    consecutiveWarpsWithoutLanding += 1;
  }
  const lastSystemId = obs.system?.id ?? mem.lastSystemId;
  const previousSystemId = systemChanged
    ? mem.lastSystemId
    : mem.previousSystemId;
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
    noopLandPlanetId = null;
    noopLandStreak = 0;
  }

  let noopDockStationId = mem.noopDockStationId;
  let noopDockStreak = mem.noopDockStreak;
  const justUndocked =
    obs.scene !== SceneType.STATION && mem.lastScene === SceneType.STATION;
  if (justUndocked) {
    const stationId = obs.system?.stations[0]?.id ?? null;
    const dockStayProductive =
      obs.player.credits !== mem.lastCreditsSeen ||
      obs.player.maxHull !== mem.lastMaxHull ||
      cargoChangedThisFold ||
      questCountChanged;
    if (dockStayProductive) {
      noopDockStationId = null;
      noopDockStreak = 0;
    } else if (noopDockStationId === stationId) {
      noopDockStreak += 1;
    } else {
      noopDockStationId = stationId;
      noopDockStreak = 1;
    }
  }
  if (systemChanged) {
    noopDockStationId = null;
    noopDockStreak = 0;
  }

  const loanState = obs.activeLoans
    ? {
        balance: obs.loanBalance ?? 0,
        missedPayments: obs.loanMissedPayments ?? 0,
      }
    : undefined;

  const activeQuestDelivery: ActiveQuestDelivery[] = obs.quests
    .filter(
      (q): q is typeof q & { targetSystemId: string } => !!q.targetSystemId,
    )
    .map((q) => ({ questId: q.id, targetSystemId: q.targetSystemId }));

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

  const starMapStallFolds =
    obs.scene === SceneType.STAR_MAP &&
    mem.lastScene === SceneType.STAR_MAP &&
    obs.player.fuel === mem.lastFuelSeen
      ? mem.starMapStallFolds + 1
      : 0;

  const completedQuestsBaseline =
    mem.completedQuestsBaseline >= 0
      ? mem.completedQuestsBaseline
      : (obs.questsCompleted ?? 0);

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
    noopDockStationId,
    noopDockStreak,
    lastCreditsSeen: obs.player.credits,
  };

  if (!mem.deadlockDetected && detectDeadlock(obs, next)) {
    logger.warn(
      `[DEADLOCK] step=${step} credits=${obs.player.credits} hull=${obs.player.hullFraction} system=${obs.system?.id ?? "?"}`,
    );
    next.deadlockDetected = true;
  }

  return next;
}
