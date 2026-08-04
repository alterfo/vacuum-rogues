import type { GameEngine } from "@/systems/GameEngine";
import { SceneType, StationType, FactionType } from "@/types";
import type { ResourceType, QuestType } from "@/types";
import type { Faction } from "@/types/faction";
import { npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { isLiberationBlocker } from "@/systems/galaxy/liberation";
import {
  GEAR_CATALOG,
  GearKind,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";
import { isDowned } from "@/systems/combat/godMode";
import { playerPowerIndex } from "@/systems/campaign/playerPower";
import { POWER_INDEX_BATTLE_READY_THRESHOLD } from "@/config/balance";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { TradeSystem } from "@/systems/TradeSystem";
import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import {
  hasStationOfType,
  hasBankAccess,
  isNearOvermindCore,
  overmindShareOf,
  isQuestDeliveryHere,
  loanStatusOf,
  systemShopPrices,
} from "./observeHelpers";
import {
  bestAffordableGear,
  hullUpgradeNetCost,
  cheapestMicromodule,
  planArmUp,
} from "./equipmentQueries";
import { hullTradeInPrice } from "@/systems/equipment/sellHull";
import { micromodulePrice } from "@/systems/equipment/micromoduleShop";
import {
  takeableBoardQuestCount,
  reachableNeighbors,
  questRoutingPreference,
  systemHopDistances,
  overmindFrontHopDistances,
  directedHopDistancesTo,
  repairCost,
} from "./engineQueries";

const TRADE = new TradeSystem();

export type PlayerActionKind =
  | "move" // fly / take off / leave a sub-screen back toward flight
  | "warp" // jump to a connected system
  | "land" // land on a planet (flight → planet)
  | "dock" // dock at a station (flight → station)
  | "trade" // buy/sell at a market (planet or trade screen)
  | "take-quest" // accept a contract offered at the current location
  | "attack" // fire on a hostile in range
  | "flee" // disengage from a hostile
  | "repair" // restore hull at a repair-capable base
  | "wait" // pass / advance a frame
  | "buy-gear" // purchase a weapon/equipment/engine at a shop
  | "upgrade-hull" // swap to a better hull at the equipment shop
  | "buy-module" // buy a micromodule at a CRAFT_CENTER station
  | "take-loan" // borrow credits from the bank
  | "repay-loan" // repay an outstanding loan
  | "sell-cargo" // explicit sell-only action (vs. trade, which also buys)
  | "arm-up" // buy + install a stronger weapon (raise installed firepower)
  | "liberate"; // free the current (garrison-cleared) captured system

export const ACTION_ORDER: readonly PlayerActionKind[] = [
  "move",
  "warp",
  "land",
  "dock",
  "trade",
  "take-quest",
  "attack",
  "flee",
  "repair",
  "wait",
  "buy-gear",
  "upgrade-hull",
  "buy-module",
  "take-loan",
  "repay-loan",
  "sell-cargo",
  "arm-up",
  "liberate",
];

const LEGAL_ACTION_ORDER: readonly PlayerActionKind[] = ACTION_ORDER;

const BUY_MODULE_MIN_CREDITS = 800;

export const SHIPYARD_HULL_HP = 180;
export const SHIPYARD_MIN_TECH = GEAR_CATALOG.reduce(
  (min, g) =>
    g.kind === GearKind.HULL && (g as HullSpec).hp >= SHIPYARD_HULL_HP
      ? Math.min(min, g.techLevel)
      : min,
  Infinity,
);

export interface PlayerSnapshot {
  credits: number;
  hull: number;
  maxHull: number;
  hullFraction: number;
  weaponDamage?: number;
  fuel: number;
  maxFuel: number;
  fuelFraction: number;
  cargo: { type: ResourceType; amount: number }[];
  cargoUsed: number;
  cargoCapacity: number;
  systemId: string;
  position: { x: number; y: number } | null;
  reputationBastions?: number;
  reputationSyndicate?: number;
  downed?: boolean;
  canAffordRepair?: boolean;
}

export interface SystemSnapshot {
  id: string;
  name: string;
  planets: {
    id: string;
    name: string;
    availableQuests: number;
    isHabitable?: boolean;
  }[];
  stations: { id: string; name: string; type: StationType }[];
  connections: number;
  neighbors?: {
    systemId: string;
    visited: boolean;
    overmindHeld: boolean;
    pirateHeld?: boolean;
    hopsToQuestTarget?: number;
    hopsToOvermindFront?: number;
    hopsToShipyard?: number;
    hopsToCore?: number;
  }[];
}

export interface NpcSnapshot {
  id: string;
  name: string;
  faction: FactionType;
  hostile: boolean;
  hullHP: number;
  damage?: number;
}

export interface QuestSnapshot {
  id: string;
  title: string;
  type: QuestType;
  targetSystemId: string | null;
  targetPlanetId?: string | null;
  rewardCredits?: number;
  collectItem?: {
    type: ResourceType;
    required: number;
    carried: number;
  } | null;
}

export interface MarketGoodSnapshot {
  resource: ResourceType;
  buy: number;
  sell: number;
}

export interface CurrentPlanetSnapshot {
  id: string;
  name: string;
  availableQuests: number;
  market: MarketGoodSnapshot[];
}

export interface Observation {
  scene: SceneType;
  hasPlayer: boolean;
  player: PlayerSnapshot | null;
  system: SystemSnapshot | null;
  currentPlanet: CurrentPlanetSnapshot | null;
  npcs: NpcSnapshot[];
  hostiles: NpcSnapshot[];
  quests: QuestSnapshot[];
  legalActions: PlayerActionKind[];
  warpInTransit?: boolean;
  hasBank?: boolean;
  hasCraftCenter?: boolean;
  hasRepairDock?: boolean;
  overmindShare?: number;
  nearOvermindCore?: boolean;
  overmindHeldHere?: boolean;
  hostileSystemIds?: readonly string[];
  questDeliveryHere?: boolean;
  activeLoans?: boolean;
  loanBalance?: number;
  loanMissedPayments?: number;
  cheapestGearPrice?: number | null;
  bestHullPrice?: number | null;
  canArmUp?: boolean;
  armUpCost?: number;
  buyGearCost?: number | null;
  buyModuleCost?: number | null;
  upgradeHullCost?: number | null;
  gameDay?: number;
  questsCompleted?: number;
  playerPowerIndex?: number;
  battleReady?: boolean;
  hopsToOvermindFront?: number;
  shipyardHere?: boolean;
}

export interface LegalActionContext {
  hasPlayer: boolean;
  planetCount: number;
  stationCount: number;
  hostileCount: number;
  connectionCount: number;
  availableQuestCount: number;
  credits?: number;
  cargoUsed?: number;
  hasCraftCenter?: boolean;
  hasAffordableModule?: boolean;
  activeLoans?: boolean;
  cheapestGearPrice?: number | null;
  bestHullPrice?: number | null;
  canLiberate?: boolean;
  canArmUp?: boolean;
  needsRepair?: boolean;
  canAffordRepair?: boolean;
}

export function legalActionsForScene(
  scene: SceneType,
  ctx: LegalActionContext,
): PlayerActionKind[] {
  const set = new Set<PlayerActionKind>();

  if (!ctx.hasPlayer) {
    return ["wait"];
  }

  switch (scene) {
    case SceneType.SPACE_FLIGHT: {
      set.add("move");
      set.add("wait");
      if (ctx.connectionCount > 0) set.add("warp");
      if (ctx.planetCount > 0) set.add("land");
      if (ctx.stationCount > 0) set.add("dock");
      if (ctx.hostileCount > 0) {
        set.add("attack");
        set.add("flee");
      }
      if (ctx.canLiberate) set.add("liberate");
      break;
    }
    case SceneType.PLANET: {
      set.add("trade");
      set.add("move");
      set.add("wait");
      if (ctx.availableQuestCount > 0) set.add("take-quest");
      if ((ctx.cargoUsed ?? 0) > 0) set.add("sell-cargo");
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (ctx.canArmUp) set.add("arm-up");
      break;
    }
    case SceneType.TRADE: {
      set.add("trade");
      set.add("move");
      set.add("wait");
      if ((ctx.cargoUsed ?? 0) > 0) set.add("sell-cargo");
      break;
    }
    case SceneType.STATION: {
      if ((ctx.needsRepair ?? true) && (ctx.canAffordRepair ?? true))
        set.add("repair");
      set.add("move");
      set.add("wait");
      if (
        ctx.cheapestGearPrice != null &&
        (ctx.credits ?? 0) >= ctx.cheapestGearPrice
      ) {
        set.add("buy-gear");
      }
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (
        ctx.hasCraftCenter &&
        (ctx.credits ?? 0) >= BUY_MODULE_MIN_CREDITS &&
        (ctx.hasAffordableModule ?? true)
      ) {
        set.add("buy-module");
      }
      if (ctx.canArmUp) set.add("arm-up");
      if (ctx.activeLoans) set.add("repay-loan");
      else set.add("take-loan");
      break;
    }
    case SceneType.EQUIPMENT_SHOP: {
      set.add("move");
      set.add("wait");
      if (
        ctx.cheapestGearPrice != null &&
        (ctx.credits ?? 0) >= ctx.cheapestGearPrice
      ) {
        set.add("buy-gear");
      }
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (ctx.canArmUp) set.add("arm-up");
      break;
    }
    case SceneType.BANK: {
      set.add("move");
      set.add("wait");
      if (ctx.activeLoans) set.add("repay-loan");
      else set.add("take-loan");
      break;
    }
    case SceneType.STAR_MAP: {
      set.add("move");
      set.add("wait");
      if (ctx.connectionCount > 0) set.add("warp");
      break;
    }
    case SceneType.WIN_SCREEN:
    case SceneType.GAME_OVER: {
      set.add("wait");
      break;
    }
    default: {
      set.add("move");
      set.add("wait");
      break;
    }
  }

  return LEGAL_ACTION_ORDER.filter((a) => set.has(a));
}

export function marketSnapshotFor(
  planet: Planet,
  player: Player,
  planetFaction?: Faction,
): MarketGoodSnapshot[] {
  return planet.market.availableResources.map((resource) => ({
    resource,
    buy: TRADE.getBuyPrice(planet, resource, player, planetFaction),
    sell: TRADE.getSellPrice(planet, resource, player, planetFaction),
  }));
}

export function buildQuestSnapshots(
  engine: GameEngine,
  player: Player,
): QuestSnapshot[] {
  return engine.questManager.getActiveQuests().map((q) => {
    const collectObj = q.objectives.find(
      (o) => o.type === "COLLECT_ITEM" && !o.completed && o.itemType,
    );
    const carried = collectObj
      ? (player.inventory.resources.find((r) => r.type === collectObj.itemType)
          ?.amount ?? 0)
      : 0;
    return {
      id: q.id,
      title: q.title,
      type: q.type,
      targetSystemId: q.targetSystemId ?? null,
      targetPlanetId: q.targetPlanetId ?? null,
      rewardCredits: q.reward.credits,
      collectItem: collectObj
        ? {
            type: collectObj.itemType as ResourceType,
            required: collectObj.targetAmount,
            carried,
          }
        : null,
    };
  });
}

export function observe(
  engine: GameEngine,
  completedQuestsBaseline = 0,
): Observation {
  const scene = engine.currentSceneType;
  const player = engine.player;
  const galaxy = engine.galaxy;

  if (!player || !galaxy) {
    return {
      scene,
      hasPlayer: false,
      player: null,
      system: null,
      currentPlanet: null,
      npcs: [],
      hostiles: [],
      quests: [],
      legalActions: legalActionsForScene(scene, {
        hasPlayer: false,
        planetCount: 0,
        stationCount: 0,
        hostileCount: 0,
        connectionCount: 0,
        availableQuestCount: 0,
      }),
      warpInTransit: false,
      hasBank: false,
      hasCraftCenter: false,
      hasRepairDock: false,
      overmindShare: 0,
      nearOvermindCore: false,
      questDeliveryHere: false,
      activeLoans: false,
      cheapestGearPrice: null,
      bestHullPrice: null,
      gameDay: 0,
      questsCompleted: 0,
    };
  }

  const ship = player.ship;
  const cargoCapacity = cargoCapacityOf(engine.playerLoadout);
  const cargo = player.inventory.resources.map((r) => ({
    type: r.type,
    amount: r.amount,
  }));
  const cargoUsed = cargo.reduce((sum, r) => sum + r.amount, 0);
  const flightPos =
    engine.liveFlightShipPos ?? engine.lastFlightShipPos ?? null;

  const playerSnapshot: PlayerSnapshot = {
    credits: player.credits,
    hull: ship.hullHP,
    maxHull: ship.maxHull,
    hullFraction: ship.maxHull > 0 ? ship.hullHP / ship.maxHull : 0,
    weaponDamage: engine.playerLoadout?.derivedStats().weaponDamage ?? 0,
    fuel: ship.energy,
    maxFuel: ship.maxEnergy,
    fuelFraction: ship.maxEnergy > 0 ? ship.energy / ship.maxEnergy : 0,
    cargo,
    cargoUsed,
    cargoCapacity,
    systemId: player.currentSystemId,
    position: flightPos ? { x: flightPos.x, y: flightPos.y } : null,
    reputationBastions: player.getReputation(FactionType.BASTIONS),
    reputationSyndicate: player.getReputation(FactionType.SYNDICATE),
    downed: isDowned(player),
    canAffordRepair: player.credits >= (repairCost(engine) ?? 0),
  };

  const system =
    galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;

  const quests: QuestSnapshot[] = buildQuestSnapshots(engine, player);

  const questTargetSystemId = questRoutingPreference(
    quests,
    system?.id ?? null,
  );
  const hopsToQuestTarget =
    questTargetSystemId != null
      ? systemHopDistances(galaxy.systems, questTargetSystemId)
      : null;

  const overmindFrontSeeds =
    galaxy.overmindCoreSystemId !== "" &&
    !galaxy.overmindSystems.includes(galaxy.overmindCoreSystemId)
      ? [...galaxy.overmindSystems, galaxy.overmindCoreSystemId]
      : galaxy.overmindSystems;
  const hopsToOvermindFront =
    overmindFrontSeeds.length > 0
      ? overmindFrontHopDistances(galaxy.systems, overmindFrontSeeds)
      : null;
  const hostileSystemIds = [...overmindFrontSeeds, ...galaxy.pirateSystems];

  const shipyardSeeds = galaxy.systems
    .filter(
      (s) =>
        s.techLevel >= SHIPYARD_MIN_TECH &&
        s.planets.length > 0 &&
        !galaxy.isHostileSystem(s.id),
    )
    .map((s) => s.id);
  const safeTransitSystems = galaxy.systems.filter(
    (s) => !galaxy.isHostileSystem(s.id),
  );
  const hopsToShipyard =
    shipyardSeeds.length > 0
      ? directedHopDistancesTo(safeTransitSystems, shipyardSeeds)
      : null;
  const hopsToCore =
    galaxy.overmindCoreSystemId !== ""
      ? directedHopDistancesTo(galaxy.systems, [galaxy.overmindCoreSystemId])
      : null;
  const shipyardHere = system != null && shipyardSeeds.includes(system.id);

  const systemSnapshot: SystemSnapshot | null = system
    ? {
        id: system.id,
        name: system.name,
        planets: system.planets.map((p) => ({
          id: p.id,
          name: p.name,
          availableQuests: takeableBoardQuestCount(
            engine,
            p.id,
            completedQuestsBaseline,
          ),
          isHabitable: p.isHabitable,
        })),
        stations: system.stations.map((st) => ({
          id: st.id,
          name: st.name,
          type: st.type,
        })),
        connections: system.connections.length,
        neighbors: reachableNeighbors(galaxy.systems, system.id).map((c) => ({
          systemId: c.toSystemId,
          visited:
            galaxy.systems.find((s) => s.id === c.toSystemId)?.explored ??
            false,
          overmindHeld:
            galaxy.isOvermindSystem(c.toSystemId) ||
            (galaxy.overmindCoreSystemId !== "" &&
              c.toSystemId === galaxy.overmindCoreSystemId),
          pirateHeld: galaxy.isPirateSystem(c.toSystemId),
          hopsToQuestTarget: hopsToQuestTarget?.get(c.toSystemId),
          hopsToOvermindFront: hopsToOvermindFront?.get(c.toSystemId),
          hopsToShipyard: hopsToShipyard?.get(c.toSystemId),
          hopsToCore: hopsToCore?.get(c.toSystemId),
        })),
      }
    : null;

  const systemHeld = system ? galaxy.isHostileSystem(system.id) : false;
  const npcs: NpcSnapshot[] = system
    ? npcsPresentInSystem(galaxy, system.id).map((n) => ({
        id: n.id,
        name: n.name,
        faction: n.race,
        hostile: n.hostile || (systemHeld && isLiberationBlocker(n)),
        hullHP: n.hullHP,
        damage: n.damage,
      }))
    : [];
  const hostiles = npcs.filter((n) => n.hostile);

  const landed =
    player.landedPlanetId && system
      ? (system.planets.find((p) => p.id === player.landedPlanetId) ?? null)
      : null;
  const currentPlanet: CurrentPlanetSnapshot | null = landed
    ? {
        id: landed.id,
        name: landed.name,
        availableQuests:
          systemSnapshot?.planets.find((p) => p.id === landed.id)
            ?.availableQuests ?? 0,
        market: marketSnapshotFor(landed, player, system?.ownerFaction),
      }
    : null;

  const availableQuestCount =
    currentPlanet?.availableQuests ??
    (systemSnapshot
      ? systemSnapshot.planets.reduce(
          (max, p) => Math.max(max, p.availableQuests),
          0,
        )
      : 0);

  const hasCraftCenter = system
    ? hasStationOfType(system.stations, StationType.CRAFT_CENTER)
    : false;
  const hasRepairDock = system
    ? hasStationOfType(system.stations, StationType.REPAIR_DOCK)
    : false;
  const hasBank = system
    ? hasBankAccess(currentPlanet != null, system.stations)
    : false;
  const overmindShare = overmindShareOf(
    galaxy.overmindSystems.length,
    galaxy.systems.length,
  );
  const nearOvermindCore = isNearOvermindCore(
    system,
    galaxy.overmindCoreSystemId,
  );
  const overmindHeldHere =
    system != null &&
    (galaxy.isOvermindSystem(system.id) ||
      (galaxy.overmindCoreSystemId !== "" &&
        system.id === galaxy.overmindCoreSystemId));
  const questDeliveryHere = isQuestDeliveryHere(quests, player.currentSystemId);
  const loanStatus = loanStatusOf(engine.bankingService, player.id);
  const { cheapestGearPrice, bestHullPrice } = system
    ? systemShopPrices({
        seed: galaxy.id,
        day: galaxy.gameDays,
        system: {
          id: system.id,
          techLevel: system.techLevel,
          planets: system.planets,
          stations: system.stations,
        },
        fittedHullHp: engine.playerLoadout?.hull.hp ?? 0,
        fittedHullTradeIn: engine.playerLoadout
          ? hullTradeInPrice(engine.playerLoadout.hull)
          : 0,
      })
    : { cheapestGearPrice: null, bestHullPrice: null };

  const affordableModule = hasCraftCenter ? cheapestMicromodule(engine) : null;
  const hasAffordableModule = affordableModule != null;
  const buyGearCost = bestAffordableGear(engine)?.price ?? null;
  const buyModuleCost = affordableModule
    ? micromodulePrice(affordableModule)
    : null;
  const upgradeHullCost = hullUpgradeNetCost(engine);
  const canLiberate = engine.canLiberateCurrentSystem();
  const armUpPlan = planArmUp(engine);
  const armUp = armUpPlan != null;
  const armUpCost = armUpPlan?.buyPrice ?? 0;

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: systemSnapshot?.planets.length ?? 0,
    stationCount: systemSnapshot?.stations.length ?? 0,
    hostileCount: hostiles.length,
    connectionCount: systemSnapshot?.connections ?? 0,
    availableQuestCount,
    credits: player.credits,
    cargoUsed,
    hasCraftCenter,
    hasAffordableModule,
    activeLoans: loanStatus.active,
    cheapestGearPrice,
    bestHullPrice,
    canLiberate,
    canArmUp: armUp,
    needsRepair: ship.hullHP < ship.maxHull,
    canAffordRepair: player.credits >= (repairCost(engine) ?? 0),
  }).filter(
    (a) =>
      !playerSnapshot.downed ||
      (a !== "warp" && a !== "attack" && a !== "flee"),
  );

  const flightScene = engine.currentScene as { pendingWarp?: unknown } | null;
  const warpInTransit =
    scene === SceneType.SPACE_FLIGHT && flightScene?.pendingWarp != null;

  const playerPower = playerPowerIndex({
    maxHull: ship.maxHull,
    weaponDamage: playerSnapshot.weaponDamage ?? 0,
    credits: player.credits,
    rank: player.rank,
  });
  const battleReady = playerPower >= POWER_INDEX_BATTLE_READY_THRESHOLD;
  const hopsToFront =
    system != null ? hopsToOvermindFront?.get(system.id) : undefined;

  return {
    scene,
    hasPlayer: true,
    player: playerSnapshot,
    system: systemSnapshot,
    currentPlanet,
    npcs,
    hostiles,
    quests,
    legalActions,
    warpInTransit,
    hasBank,
    hasCraftCenter,
    hasRepairDock,
    overmindShare,
    nearOvermindCore,
    overmindHeldHere,
    hostileSystemIds,
    questDeliveryHere,
    activeLoans: loanStatus.active,
    loanBalance: loanStatus.active ? loanStatus.balance : undefined,
    loanMissedPayments: loanStatus.active
      ? loanStatus.missedPayments
      : undefined,
    cheapestGearPrice,
    bestHullPrice,
    canArmUp: armUp,
    armUpCost,
    buyGearCost,
    buyModuleCost,
    upgradeHullCost,
    gameDay: galaxy.gameDays,
    questsCompleted: engine.questManager.getCompletedQuestIds().length,
    playerPowerIndex: playerPower,
    battleReady,
    hopsToOvermindFront: hopsToFront,
    shipyardHere,
  };
}
