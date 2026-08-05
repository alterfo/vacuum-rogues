import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcShip } from "@/domain/NpcShip";
import {
  NpcRole,
  NpcState,
  NpcGoalKind,
  FactionType,
  ResourceType,
} from "@/types";
import type { RouteRumor } from "@/domain/RouteRumor";
import { applyMarketTradeImpact } from "@/domain/Market";
import { GAME_BALANCE } from "@/config/balance";
import {
  FACTIONS,
  ROLES,
  FACTION_NAME,
  ROLE_NAME,
  ROLE_STATS,
  ROLE_LOADOUT,
} from "./npcRoleCatalog";
import { travelDays } from "./npcTravel";
import { npcOrbitStep, advanceNpcOrbit } from "./npcPlacement";
import type { DwellTracker } from "./NpcGarrisonCombat";
import { logger } from "@/utils/logger";

const NPCS_PER_SYSTEM = 4;

const NPC_TRADE_SUPPLY_IMPACT = 0.02;

const NPC_TRADE_PRICE_IMPACT_PER_UNIT = GAME_BALANCE.marketImpactPerUnit * 0.5;

function npcTradeImpact(qty: number): number {
  return Math.min(
    qty * NPC_TRADE_PRICE_IMPACT_PER_UNIT,
    GAME_BALANCE.marketImpactMaxPerTrade,
  );
}

const RUMOR_TRADE_QTY = 20;

export function rumorReactionChance(marginPct: number): number {
  const over = Math.max(0, marginPct - GAME_BALANCE.rumorMarginExpire);
  const p =
    GAME_BALANCE.rumorNpcBaseChance + GAME_BALANCE.rumorNpcMarginScale * over;
  return Math.min(GAME_BALANCE.rumorNpcMaxChance, Math.max(0, p));
}

const TRADEABLE_GOODS: ResourceType[] = [
  ResourceType.METALS,
  ResourceType.CRYSTALS,
  ResourceType.ORGANICS,
  ResourceType.MEDICINE,
  ResourceType.ELECTRONICS,
  ResourceType.LUXURY,
  ResourceType.DATA_CORES,
];

const MIN_DWELL_DAYS = 3;

export class NpcPlacementEconomy implements DwellTracker {
  private readonly arrivalDwellCountdown = new Map<string, number>();
  private readonly rumorDestPlanet = new Map<string, string>();

  mark(id: string): void {
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
  }

  clear(id: string): void {
    this.arrivalDwellCountdown.delete(id);
  }

  consumeDwell(id: string): boolean {
    const left = this.arrivalDwellCountdown.get(id) ?? 0;
    if (left > 0) {
      this.arrivalDwellCountdown.set(id, left - 1);
      return true;
    }
    return false;
  }

  takeRumorDestPlanet(id: string): string | undefined {
    const v = this.rumorDestPlanet.get(id);
    this.rumorDestPlanet.delete(id);
    return v;
  }

  spawnInitial(galaxy: Galaxy, rng: SeededRNG): NpcShip[] {
    if (galaxy.systems.length === 0) return galaxy.npcShips;

    const count = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    for (let i = 0; i < count; i++) {
      this.spawnOne(galaxy, rng, `npc_${i}`);
    }

    const homeSystems = galaxy.systems.filter((s) => s.isFactionHome);
    let homeIdx = 0;
    for (const homeSystem of homeSystems) {
      for (let j = 0; j < NPCS_PER_SYSTEM; j++) {
        this.spawnOneInSystem(
          galaxy,
          rng,
          `npc_home_${homeIdx}_${j}`,
          homeSystem.id,
        );
        homeIdx++;
      }
    }

    logger.info(`Spawned ${galaxy.npcShips.length} NPC ships`);
    return galaxy.npcShips;
  }

  private spawnOne(galaxy: Galaxy, rng: SeededRNG, id: string): void {
    const system = galaxy.systems[rng.nextInt(0, galaxy.systems.length - 1)];
    const role = ROLES[rng.nextInt(0, ROLES.length - 1)];
    const faction =
      role === NpcRole.PIRATE
        ? FactionType.OUTLANDERS
        : FACTIONS[rng.nextInt(0, FACTIONS.length - 1)];
    const stats = ROLE_STATS[role];

    galaxy.npcShips.push(
      new NpcShip({
        id,
        name: `${ROLE_NAME[role]} ${FACTION_NAME[faction]} ${id}`,
        race: faction,
        faction: faction as unknown as import("@/types/faction").Faction,
        role,
        hullHP: stats.hull,
        maxHull: stats.hull,
        shields: stats.shields,
        speed: stats.speed,
        damage: stats.damage,
        currentSystemId: system.id,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: rng.nextInt(100, 1000),
        reputation: 0,
        shieldPower: stats.shieldPower,
        loadoutSummary: ROLE_LOADOUT[role],
        cargo: role === NpcRole.TRADER ? this.pickTraderCargo(system, rng) : [],
      }),
    );
    this.mark(id);
  }

  private spawnOneInSystem(
    galaxy: Galaxy,
    rng: SeededRNG,
    id: string,
    systemId: string,
  ): void {
    const system = galaxy.systems.find((s) => s.id === systemId);
    if (!system) return;
    const role = ROLES[rng.nextInt(0, ROLES.length - 1)];
    const faction =
      role === NpcRole.PIRATE
        ? FactionType.OUTLANDERS
        : FACTIONS[rng.nextInt(0, FACTIONS.length - 1)];
    const stats = ROLE_STATS[role];
    galaxy.npcShips.push(
      new NpcShip({
        id,
        name: `${ROLE_NAME[role]} ${FACTION_NAME[faction]} ${id}`,
        race: faction,
        faction: faction as unknown as import("@/types/faction").Faction,
        role,
        hullHP: stats.hull,
        maxHull: stats.hull,
        shields: stats.shields,
        speed: stats.speed,
        damage: stats.damage,
        currentSystemId: system.id,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: rng.nextInt(100, 1000),
        reputation: 0,
        shieldPower: stats.shieldPower,
        loadoutSummary: ROLE_LOADOUT[role],
        cargo: role === NpcRole.TRADER ? this.pickTraderCargo(system, rng) : [],
      }),
    );
    this.mark(id);
  }

  private pickTraderCargo(
    system: StarSystem,
    rng: SeededRNG,
  ): { goodId: string; qty: number }[] {
    let candidateGoods: string[] = TRADEABLE_GOODS as string[];

    const planet = system.planets.find(
      (p) => p.market && p.market.availableResources.length > 0,
    );
    if (planet) {
      const priced = planet.market.availableResources
        .map((r) => ({ r: r as string, price: planet.market.getPrice(r) }))
        .sort((a, b) => a.price - b.price);
      candidateGoods = priced.map((p) => p.r);
    }

    const count = rng.nextInt(1, Math.min(3, candidateGoods.length));
    const result: { goodId: string; qty: number }[] = [];
    const used = new Set<string>();
    let attempts = 0;
    while (result.length < count && attempts < candidateGoods.length * 3) {
      const idx = rng.nextInt(0, candidateGoods.length - 1);
      attempts++;
      if (!used.has(candidateGoods[idx])) {
        used.add(candidateGoods[idx]);
        result.push({ goodId: candidateGoods[idx], qty: rng.nextInt(5, 20) });
      }
    }
    return result;
  }

  simulateTraderTrade(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
    sellPlanetId?: string,
  ): void {
    const system = galaxy.systems.find((s) => s.id === npc.currentSystemId);
    if (!system) return;

    const hasMarket = (p: {
      market?: { availableResources: ResourceType[] };
    }) => !!p.market && p.market.availableResources.length > 0;
    const planet =
      (sellPlanetId
        ? system.planets.find((p) => p.id === sellPlanetId && hasMarket(p))
        : undefined) ?? system.planets.find(hasMarket);
    if (!planet) return;

    const market = planet.market;

    for (const item of npc.cargo) {
      const idx = market.availableResources.indexOf(
        item.goodId as ResourceType,
      );
      if (idx >= 0) {
        market.supplyVector[idx] = Math.min(
          5.0,
          (market.supplyVector[idx] ?? 1) + item.qty * NPC_TRADE_SUPPLY_IMPACT,
        );
        applyMarketTradeImpact(
          market,
          item.goodId as ResourceType,
          -npcTradeImpact(item.qty),
        );
      }
    }

    npc.cargo = this.pickTraderCargo(system, rng);
    for (const item of npc.cargo) {
      const idx = market.availableResources.indexOf(
        item.goodId as ResourceType,
      );
      if (idx >= 0) {
        market.supplyVector[idx] = Math.max(
          0.1,
          (market.supplyVector[idx] ?? 1) - item.qty * NPC_TRADE_SUPPLY_IMPACT,
        );
        applyMarketTradeImpact(
          market,
          item.goodId as ResourceType,
          npcTradeImpact(item.qty),
        );
      }
    }
  }

  pickQuestTarget(
    currentSystemId: string,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): string | null {
    const candidates = galaxy.systems
      .map((s) => s.id)
      .filter((id) => id !== currentSystemId);
    if (candidates.length === 0) return null;
    return candidates[rng.nextInt(0, candidates.length - 1)];
  }

  advanceTrackedPositions(galaxy: Galaxy): void {
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (!npc.hasWorldPosition()) continue;
      const step = npcOrbitStep(galaxy.id, npc.id);
      const next = advanceNpcOrbit(
        { x: npc.worldX as number, y: npc.worldY as number },
        step,
      );
      npc.setWorldPosition(next.x, next.y);
    }
  }

  removeNpc(galaxy: Galaxy, npcId: string): void {
    const idx = galaxy.npcShips.findIndex((n) => n.id === npcId);
    if (idx >= 0) galaxy.npcShips.splice(idx, 1);
  }

  pruneAndReplenish(
    galaxy: Galaxy,
    rng: SeededRNG,
    onDead: (npcId: string) => void,
    isExcludedFromTarget: (npcId: string) => boolean,
  ): void {
    for (let i = galaxy.npcShips.length - 1; i >= 0; i--) {
      if (galaxy.npcShips[i].state === NpcState.DEAD) {
        const deadId = galaxy.npcShips[i].id;
        onDead(deadId);
        this.rumorDestPlanet.delete(deadId);
        galaxy.npcShips.splice(i, 1);
      }
    }

    const target = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    let regular = galaxy.npcShips.filter(
      (n) => !isExcludedFromTarget(n.id),
    ).length;
    let guard = 0;
    while (regular < target && guard++ < 1000) {
      this.spawnOne(
        galaxy,
        rng,
        `npc_d${galaxy.gameDays}_${galaxy.npcShips.length}`,
      );
      regular++;
    }
  }

  arrive(npc: NpcShip): void {
    if (npc.destinationSystemId) {
      npc.currentSystemId = npc.destinationSystemId;
    }
    npc.destinationSystemId = null;
    npc.daysToArrival = 0;
    npc.state = this.arrivalState(npc.goal?.kind);
    npc.goal = null;
    this.mark(npc.id);
  }

  applyRumorDiversion(npc: NpcShip, galaxy: Galaxy, rumor: RouteRumor): void {
    const sourceMarket = galaxy.systems
      .find((s) => s.id === rumor.fromSystemId)
      ?.planets.find((p) => p.id === rumor.fromPlanetId)?.market;
    if (sourceMarket) {
      applyMarketTradeImpact(
        sourceMarket,
        rumor.resource,
        npcTradeImpact(RUMOR_TRADE_QTY),
      );
    }
    npc.goal = { kind: NpcGoalKind.TRADE, targetSystemId: rumor.toSystemId };
    npc.destinationSystemId = rumor.toSystemId;
    npc.daysToArrival = travelDays(
      galaxy,
      npc.currentSystemId,
      rumor.toSystemId,
    );
    npc.cargo = [{ goodId: rumor.resource, qty: RUMOR_TRADE_QTY }];
    npc.state = NpcState.TRAVELING;
    this.rumorDestPlanet.set(npc.id, rumor.toPlanetId);
  }

  private arrivalState(kind?: NpcGoalKind): NpcState {
    switch (kind) {
      case NpcGoalKind.TRADE:
        return NpcState.TRADING;
      case NpcGoalKind.QUEST:
        return NpcState.QUESTING;
      case NpcGoalKind.PATROL:
      case NpcGoalKind.HUNT:
        return NpcState.PATROLLING;
      default:
        return NpcState.PATROLLING;
    }
  }
}

export function npcsPresentInSystem(
  galaxy: Galaxy,
  systemId: string,
): NpcShip[] {
  return galaxy.npcShips.filter(
    (n) =>
      n.currentSystemId === systemId &&
      n.state !== NpcState.TRAVELING &&
      n.state !== NpcState.DEAD,
  );
}
