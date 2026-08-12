import type { StarSystem } from "./StarSystem";
import type { Overmind } from "./Overmind";
import type { GalacticEvent } from "./GalacticEvent";
import type { NpcShip } from "./NpcShip";
import type { RouteRumor } from "./RouteRumor";
import type { NewsEvent, OvermindSpreadState } from "@/types";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { logger } from "@/utils/logger";

const NEWS_FEED_MAX = 100;

export class Galaxy {
  gameDays = 0;
  newsFeed: NewsEvent[] = [];
  questBoards: Record<string, number> = {};
  overmindSystems: string[] = [];
  pirateSystems: string[] = [];
  overmindCoreSystemId: string = "";
  overmindArc: OvermindSpreadState = {
    dayZero: -1,
    lastSpreadDay: -1,
    status: "dormant",
    threat: 0,
    peakThreat: 0,
  };
  activeTradeBoomSystems: Record<string, number> = {};
  activeRumors: RouteRumor[] = [];
  soldOutGear?: Record<string, number>;

  constructor(
    public readonly id: string,
    public readonly systems: StarSystem[],
    public readonly overmind: Overmind,
    public readonly activeEvents: GalacticEvent[],
    public readonly npcShips: NpcShip[] = [],
    overmindSystems: string[] = [],
    overmindCoreSystemId: string = "",
    pirateSystems: string[] = [],
  ) {
    this.overmindSystems = overmindSystems;
    this.overmindCoreSystemId = overmindCoreSystemId;
    this.pirateSystems = pirateSystems;
  }

  isOvermindSystem(systemId: string): boolean {
    return this.overmindSystems.includes(systemId);
  }

  isOvermindMajority(): boolean {
    return this.overmindSystems.length > this.systems.length / 2;
  }

  isOvermindVictory(
    graceDays: number,
    minSystems: number,
    currentDay: number,
  ): boolean {
    if (this.systems.length < minSystems) return false;
    if (currentDay <= graceDays) return false;
    return this.isOvermindMajority();
  }

  addOvermindSystem(systemId: string): void {
    this.removePirateSystem(systemId);
    if (!this.overmindSystems.includes(systemId)) {
      this.overmindSystems.push(systemId);
    }
  }

  removeOvermindSystem(systemId: string): void {
    const idx = this.overmindSystems.indexOf(systemId);
    if (idx >= 0) this.overmindSystems.splice(idx, 1);
  }

  isPirateSystem(systemId: string): boolean {
    return this.pirateSystems.includes(systemId);
  }

  isHostileSystem(systemId: string): boolean {
    return this.isOvermindSystem(systemId) || this.isPirateSystem(systemId);
  }

  addPirateSystem(systemId: string): void {
    this.removeOvermindSystem(systemId);
    if (!this.pirateSystems.includes(systemId)) {
      this.pirateSystems.push(systemId);
    }
  }

  removePirateSystem(systemId: string): void {
    const idx = this.pirateSystems.indexOf(systemId);
    if (idx >= 0) this.pirateSystems.splice(idx, 1);
  }

  tryLiberate(systemId: string, source: "player" | "npc" = "npc"): boolean {
    const wasOvermind = this.isOvermindSystem(systemId);
    const wasPirate = this.isPirateSystem(systemId);
    if (!wasOvermind && !wasPirate) return false;
    if (
      wasOvermind &&
      source !== "player" &&
      systemId === this.overmindCoreSystemId
    ) {
      return false;
    }

    if (wasOvermind) {
      this.removeOvermindSystem(systemId);
      if (source === "player") {
        this.overmindArc.playerLiberations =
          (this.overmindArc.playerLiberations ?? 0) + 1;
      }
    } else {
      this.removePirateSystem(systemId);
    }

    const sys = this.systems.find((s) => s.id === systemId);
    this.addNewsEvent({
      type: "SYSTEM_LIBERATED",
      systemId,
      day: this.gameDays,
      description: `Система ${sys?.name ?? systemId} освобождена от захватчиков!`,
    });
    return true;
  }

  systemForLocation(locationId: string): StarSystem | null {
    return (
      this.systems.find((s) => s.planets.some((p) => p.id === locationId)) ??
      this.systems.find((s) => s.id === locationId) ??
      null
    );
  }

  getHostileShare(): number {
    if (this.systems.length === 0) return 0;
    return (
      (this.overmindSystems.length + this.pirateSystems.length) /
      this.systems.length
    );
  }

  getOvermindAdjacentSystems(excludeSystemId?: string): StarSystem[] {
    const overmindSet = new Set(this.overmindSystems);
    const seen = new Set<string>();
    const result: StarSystem[] = [];
    for (const oid of this.overmindSystems) {
      const overmindSys = this.systems.find((s) => s.id === oid);
      if (!overmindSys) continue;
      for (const conn of overmindSys.connections) {
        const neighbor = this.systems.find((s) => s.id === conn.toSystemId);
        if (
          neighbor &&
          !overmindSet.has(neighbor.id) &&
          neighbor.id !== excludeSystemId &&
          !seen.has(neighbor.id)
        ) {
          seen.add(neighbor.id);
          result.push(neighbor);
        }
      }
    }
    return result;
  }

  applyTradeBoom(systemId: string, durationDays: number): void {
    const expiresDay = this.gameDays + durationDays;
    if (this.activeTradeBoomSystems[systemId]) {
      this.activeTradeBoomSystems[systemId] = expiresDay;
      return;
    }
    this.activeTradeBoomSystems[systemId] = expiresDay;
    const system = this.systems.find((s) => s.id === systemId);
    if (!system) return;
    for (const planet of system.planets) {
      if (!planet.market) continue;
      for (let i = 0; i < planet.market.priceMultipliers.length; i++) {
        planet.market.priceMultipliers[i] = Math.max(
          0.4,
          (planet.market.priceMultipliers[i] ?? 1) * 0.85,
        );
      }
    }
  }

  expireGlobalEvents(): void {
    for (const [systemId, expiresDay] of Object.entries(
      this.activeTradeBoomSystems,
    )) {
      if (this.gameDays >= expiresDay) {
        const system = this.systems.find((s) => s.id === systemId);
        if (system) {
          for (const planet of system.planets) {
            if (!planet.market) continue;
            for (let i = 0; i < planet.market.priceMultipliers.length; i++) {
              planet.market.priceMultipliers[i] = Math.min(
                2.5,
                (planet.market.priceMultipliers[i] ?? 1) / 0.85,
              );
            }
          }
        }
        delete this.activeTradeBoomSystems[systemId];
      }
    }
  }

  getActiveRumors(): RouteRumor[] {
    return [...this.activeRumors].sort(
      (a, b) => b.lastMarginPct - a.lastMarginPct,
    );
  }

  addNewsEvent(event: NewsEvent): void {
    this.newsFeed.push(event);
    if (this.newsFeed.length > NEWS_FEED_MAX) {
      this.newsFeed.splice(0, this.newsFeed.length - NEWS_FEED_MAX);
    }
  }

  static generate(_seed: string): Galaxy {
    throw new GameSystemException(
      "GALAXY_GENERATE_DEPRECATED",
      "Use GalaxySimulator.generateGalaxy instead",
    );
  }

  simulateDay(): void {
    this.gameDays++;
  }

  revealSystemAndNeighbors(systemId: string): void {
    const system = this.systems.find((s) => s.id === systemId);
    if (!system) {
      logger.warn(`Cannot reveal system: ${systemId} not found`);
      return;
    }

    system.explored = true;
    system.fogOfWar = false;

    let revealedCount = 0;
    for (const connection of system.connections) {
      const neighbor = this.systems.find((s) => s.id === connection.toSystemId);
      if (neighbor && !neighbor.explored) {
        neighbor.explored = true;
        neighbor.fogOfWar = false;
        revealedCount++;
      }
    }

    logger.info(
      `Revealed system: ${system.name} and ${revealedCount} neighbors`,
    );
  }

  revealSystemsWithinHops(systemId: string, hops: number): number {
    const origin = this.systems.find((s) => s.id === systemId);
    if (!origin) {
      logger.warn(`Cannot reveal systems: ${systemId} not found`);
      return 0;
    }

    const byId = new Map(this.systems.map((s) => [s.id, s]));
    const adj = new Map<string, Set<string>>();
    for (const s of this.systems) adj.set(s.id, new Set());
    for (const s of this.systems) {
      for (const c of s.connections) {
        if (byId.has(c.toSystemId)) {
          adj.get(s.id)!.add(c.toSystemId);
          adj.get(c.toSystemId)!.add(s.id);
        }
      }
    }

    origin.explored = true;
    origin.fogOfWar = false;

    let revealed = 0;
    const dist = new Map<string, number>([[systemId, 0]]);
    const queue = [systemId];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const d = dist.get(cur)!;
      if (d >= hops) continue;
      for (const n of adj.get(cur) ?? []) {
        if (dist.has(n)) continue;
        dist.set(n, d + 1);
        queue.push(n);
        const neighbor = byId.get(n)!;
        if (!neighbor.explored) {
          neighbor.explored = true;
          neighbor.fogOfWar = false;
          revealed++;
        }
      }
    }

    logger.info(
      `Revealed ${revealed} systems within ${hops} hops of ${origin.name}`,
    );
    return revealed;
  }
}
