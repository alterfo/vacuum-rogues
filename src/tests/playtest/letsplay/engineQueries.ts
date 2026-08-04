import type { GameEngine } from "@/systems/GameEngine";
import type { StarSystem } from "@/domain/StarSystem";
import type { Planet } from "@/domain/Planet";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { QuestType } from "@/types";
import type { ResourceType } from "@/types";
import { RESOURCE_BASE_PRICES } from "@/config/balance";
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

export function currentSystem(engine: GameEngine): StarSystem | null {
  const player = engine.player;
  const galaxy = engine.galaxy;
  if (!player || !galaxy) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

export function landedPlanet(engine: GameEngine): Planet | null {
  const sys = currentSystem(engine);
  const landedId = engine.player?.landedPlanetId;
  if (!sys || !landedId) return null;
  return sys.planets.find((p) => p.id === landedId) ?? null;
}

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

export function overmindFrontHopDistances(
  systems: readonly {
    id: string;
    connections: readonly { toSystemId: string }[];
  }[],
  overmindSystemIds: readonly string[],
): ReadonlyMap<string, number> {
  const knownIds = new Set(systems.map((s) => s.id));
  const dist = new Map<string, number>();
  const adjacent = new Map<string, Set<string>>();
  for (const s of systems) adjacent.set(s.id, new Set());
  for (const s of systems) {
    for (const c of s.connections) {
      if (!knownIds.has(c.toSystemId)) continue;
      adjacent.get(s.id)?.add(c.toSystemId);
      adjacent.get(c.toSystemId)?.add(s.id);
    }
  }
  const queue: string[] = [];
  for (const oid of overmindSystemIds) {
    if (!knownIds.has(oid) || dist.has(oid)) continue;
    dist.set(oid, 0);
    queue.push(oid);
  }
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

export function directedHopDistancesTo(
  systems: readonly {
    id: string;
    connections: readonly { toSystemId: string }[];
  }[],
  seedSystemIds: readonly string[],
): ReadonlyMap<string, number> {
  const knownIds = new Set(systems.map((s) => s.id));
  const reversed = new Map<string, Set<string>>();
  for (const s of systems) reversed.set(s.id, new Set());
  for (const s of systems) {
    for (const c of s.connections) {
      if (!knownIds.has(c.toSystemId)) continue;
      reversed.get(c.toSystemId)?.add(s.id);
    }
  }
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const sid of seedSystemIds) {
    if (!knownIds.has(sid) || dist.has(sid)) continue;
    dist.set(sid, 0);
    queue.push(sid);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(cur) ?? 0;
    for (const n of reversed.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

export function questRoutingPreference(
  quests: readonly {
    type: QuestType;
    targetSystemId: string | null;
    collectItem?: { carried: number; required: number } | null;
  }[],
  currentSystemId: string | null,
): string | null {
  const quest = quests.find(
    (q) =>
      q.type === QuestType.DELIVERY &&
      q.targetSystemId != null &&
      q.targetSystemId !== currentSystemId &&
      (!q.collectItem || q.collectItem.carried >= q.collectItem.required),
  );
  return quest?.targetSystemId ?? null;
}

function isTakeableBoardQuest(offered: {
  template: {
    type: QuestType;
    objectives?: readonly {
      type: string;
      targetAmount: number;
      itemType?: ResourceType;
    }[];
    reward?: { credits: number };
  };
}): boolean {
  if (offered.template.type !== QuestType.DELIVERY) return false;
  for (const o of offered.template.objectives ?? []) {
    if (o.type !== "COLLECT_ITEM" || o.itemType == null) continue;
    const estimate =
      RESOURCE_BASE_PRICES[o.itemType] *
      QUEST_SOURCING_PRICE_ESTIMATE *
      o.targetAmount;
    if (estimate >= (offered.template.reward?.credits ?? 0)) return false;
  }
  return true;
}

const QUEST_SOURCING_PRICE_ESTIMATE = 0.75;

const MAX_ACTIVE_DELIVERY_QUESTS = 1;

const MAX_COMPLETED_DELIVERY_QUESTS = 50;

function activeDeliveryQuestCount(engine: GameEngine): number {
  return engine.questManager
    .getActiveQuests()
    .filter((q) => q.type === QuestType.DELIVERY).length;
}

function canAcceptMoreDeliveryQuests(
  engine: GameEngine,
  completedQuestsBaseline = 0,
): boolean {
  return (
    activeDeliveryQuestCount(engine) < MAX_ACTIVE_DELIVERY_QUESTS &&
    engine.questManager.getCompletedQuestIds().length -
      completedQuestsBaseline <
      MAX_COMPLETED_DELIVERY_QUESTS
  );
}

export function takeableBoardQuestCount(
  engine: GameEngine,
  planetId: string,
  completedQuestsBaseline = 0,
): number {
  if (!canAcceptMoreDeliveryQuests(engine, completedQuestsBaseline)) return 0;
  return engine.getQuestBoard(planetId).filter(isTakeableBoardQuest).length;
}

export function acceptBoardQuests(
  engine: GameEngine,
  completedQuestsBaseline = 0,
  onVisualAccept?: (quest: GeneratedQuest) => void,
): void {
  const planet = landedPlanet(engine);
  if (!planet) return;
  for (const offered of engine.getQuestBoard(planet.id)) {
    if (!canAcceptMoreDeliveryQuests(engine, completedQuestsBaseline)) break;
    if (!isTakeableBoardQuest(offered)) continue;
    if (onVisualAccept) onVisualAccept(offered);
    else engine.acceptBoardQuest(offered, planet.id);
  }
}

function sellAllCargo(
  ts: TradeSystem,
  engine: GameEngine,
  planet: Planet,
  protect: ReadonlySet<ResourceType> = new Set(),
  executor?: TradeExecutor,
): void {
  const player = engine.player;
  if (!player) return;
  const capacity = cargoCapacityOf(engine.playerLoadout);
  const planetFaction = currentSystem(engine)?.ownerFaction;
  for (const cargo of [...player.inventory.resources]) {
    if (cargo.amount <= 0 || protect.has(cargo.type)) continue;
    if (executor) {
      executor.sell(cargo.type, cargo.amount);
    } else {
      ts.executeTrade(
        player,
        planet,
        cargo.type,
        cargo.amount,
        false,
        capacity,
        engine.bank,
        planetFaction,
      );
    }
  }
}

export function executeSellAll(engine: GameEngine, planet: Planet): void {
  sellAllCargo(new TradeSystem(), engine, planet);
}

export function executeTradeOnPlanet(engine: GameEngine, planet: Planet): void {
  executeMemoryAwareTrade(engine, planet, null);
}

const TRADE_CREDIT_RESERVE_FRACTION = 0.3;

export interface TradeExecutor {
  buy(good: ResourceType, qty: number): void;
  sell(good: ResourceType, qty: number): void;
}

export function executeMemoryAwareTrade(
  engine: GameEngine,
  planet: Planet,
  preferredGood: ResourceType | null,
  maxQty?: number,
  protectGoods?: ReadonlySet<ResourceType>,
  executor?: TradeExecutor,
): void {
  const player = engine.player;
  if (!player) return;
  const ts = new TradeSystem();
  const capacity = cargoCapacityOf(engine.playerLoadout);

  sellAllCargo(ts, engine, planet, protectGoods, executor);

  if (preferredGood === null) return;

  const resources = planet.market?.availableResources ?? [];
  if (!resources.includes(preferredGood)) return;
  const holdUsed = player.inventory.resources.reduce((s, r) => s + r.amount, 0);
  const holdFree = Math.max(0, capacity - holdUsed);
  if (holdFree === 0) return;

  const planetFaction = currentSystem(engine)?.ownerFaction;
  const price = ts.getBuyPrice(planet, preferredGood, player, planetFaction);
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
    if (executor) {
      executor.buy(preferredGood, qty);
    } else {
      ts.executeTrade(
        player,
        planet,
        preferredGood,
        qty,
        true,
        capacity,
        engine.bank,
        planetFaction,
      );
    }
  }
}

export function repairCost(engine: GameEngine): number | null {
  const player = engine.player;
  if (!player) return null;
  const ship = player.ship;
  const status = hullStatus(
    ship.hullHP,
    ship.maxHull,
    engine.playerLoadout?.derivedStats().maxHull,
  );
  if (status.isPerfect) return null;
  return Math.ceil(status.missing * 2);
}

export function runInHangarPanel(engine: GameEngine, mutate: () => void): void {
  const scene = engine.currentScene as {
    e2eOpenHangar?: () => void;
    e2eCloseHangar?: () => void;
  } | null;
  const usePanel =
    typeof scene?.e2eOpenHangar === "function" &&
    typeof scene.e2eCloseHangar === "function";
  if (usePanel) scene!.e2eOpenHangar!();
  try {
    mutate();
  } finally {
    if (usePanel) scene!.e2eCloseHangar!();
  }
}

export function executeRepair(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const ship = player.ship;
  const loadout = engine.playerLoadout;
  if (loadout) applyLoadoutHullToShip(ship, loadout);
  const cost = repairCost(engine);
  if (cost == null) return;
  if (player.credits < cost) return;
  runInHangarPanel(engine, () => {
    adjustPlayerCredits(
      engine.bank,
      player,
      -cost,
      GL_COUNTERPARTY.SERVICES,
      "Ремонт корпуса",
    );
    ship.repair();
  });
}
