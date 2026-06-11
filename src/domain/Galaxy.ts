import type { StarSystem } from "./StarSystem";
import type { Overmind } from "./Overmind";
import type { GalacticEvent } from "./GalacticEvent";
import type { NpcShip } from "./NpcShip";
import type { NewsEvent } from "@/types";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { logger } from "@/utils/logger";

/** Maximum number of news events retained in the feed. */
const NEWS_FEED_MAX = 100;

export class Galaxy {
  gameDays = 0;
  /** Living-galaxy simulation events, newest last (capped at NEWS_FEED_MAX). */
  newsFeed: NewsEvent[] = [];
  /**
   * Quest board cache: maps planetId → game day when the board was last
   * refreshed. Persisted with the save so cross-session consistency is
   * preserved. The board content itself is regenerated deterministically from
   * (galaxy.id + planetId + day-bucket), so only the refresh timestamp is
   * stored here.
   */
  questBoards: Record<string, number> = {};
  /** System IDs currently controlled by OVERMIND. Serialized as string[] for save compatibility. */
  overmindSystems: string[] = [];
  /** System IDs currently controlled by pirates. Serialized as string[] for save compatibility. */
  pirateSystems: string[] = [];
  /** The core OVERMIND system; destroying it triggers the win condition. */
  overmindCoreSystemId: string = "";
  /**
   * Active TradeBoom events: maps systemId → day on which the boom expires.
   * While active, market prices in that system are reduced by 15%.
   */
  activeTradeBoomSystems: Record<string, number> = {};

  constructor(
    public readonly id: string,
    public readonly systems: StarSystem[],
    public readonly overmind: Overmind,
    public readonly activeEvents: GalacticEvent[],
    /** Autonomous NPC ships living across the galaxy (Feature 8). */
    public readonly npcShips: NpcShip[] = [],
    overmindSystems: string[] = [],
    overmindCoreSystemId: string = "",
    pirateSystems: string[] = [],
  ) {
    this.overmindSystems = overmindSystems;
    this.overmindCoreSystemId = overmindCoreSystemId;
    this.pirateSystems = pirateSystems;
  }

  /** Returns true if this system is currently controlled by OVERMIND. */
  isOvermindSystem(systemId: string): boolean {
    return this.overmindSystems.includes(systemId);
  }

  /** Returns true when OVERMIND controls more than half the galaxy (raw majority check). */
  isOvermindMajority(): boolean {
    return this.overmindSystems.length > this.systems.length / 2;
  }

  /**
   * True loss condition: majority AND past grace period AND galaxy is large
   * enough that the save is not a legacy small-map edge case.
   */
  isOvermindVictory(
    graceDays: number,
    minSystems: number,
    currentDay: number,
  ): boolean {
    if (this.systems.length < minSystems) return false;
    if (currentDay <= graceDays) return false;
    return this.isOvermindMajority();
  }

  /** Mark a system as OVERMIND-controlled (idempotent). */
  addOvermindSystem(systemId: string): void {
    if (!this.overmindSystems.includes(systemId)) {
      this.overmindSystems.push(systemId);
    }
  }

  /** Remove a system from OVERMIND control (liberate it). */
  removeOvermindSystem(systemId: string): void {
    const idx = this.overmindSystems.indexOf(systemId);
    if (idx >= 0) this.overmindSystems.splice(idx, 1);
  }

  /** Returns true if this system is currently controlled by pirates. */
  isPirateSystem(systemId: string): boolean {
    return this.pirateSystems.includes(systemId);
  }

  /** Returns true if this system is hostile (overmind or pirate). */
  isHostileSystem(systemId: string): boolean {
    return this.isOvermindSystem(systemId) || this.isPirateSystem(systemId);
  }

  /** Mark a system as pirate-controlled (idempotent; removes from overmind if present). */
  addPirateSystem(systemId: string): void {
    this.removeOvermindSystem(systemId);
    if (!this.pirateSystems.includes(systemId)) {
      this.pirateSystems.push(systemId);
    }
  }

  /** Remove a system from pirate control (liberate it). */
  removePirateSystem(systemId: string): void {
    const idx = this.pirateSystems.indexOf(systemId);
    if (idx >= 0) this.pirateSystems.splice(idx, 1);
  }

  /** Returns the hostile (overmind + pirate) share of total systems as [0, 1]. */
  getHostileShare(): number {
    if (this.systems.length === 0) return 0;
    return (
      (this.overmindSystems.length + this.pirateSystems.length) /
      this.systems.length
    );
  }

  /** Returns all star systems adjacent (connected) to any OVERMIND system that are not themselves OVERMIND-controlled and not the player's current system. */
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

  /** Apply a TradeBoom to a system (prices drop 15% for durationDays). */
  applyTradeBoom(systemId: string, durationDays: number): void {
    const expiresDay = this.gameDays + durationDays;
    if (this.activeTradeBoomSystems[systemId]) {
      // Already active: extend expiry without re-applying the multiplier.
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

  /** Expire TradeBoom effects whose endDay has passed, restoring prices. */
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

  /** Append a news event, trimming the feed to NEWS_FEED_MAX. */
  addNewsEvent(event: NewsEvent): void {
    this.newsFeed.push(event);
    if (this.newsFeed.length > NEWS_FEED_MAX) {
      this.newsFeed.splice(0, this.newsFeed.length - NEWS_FEED_MAX);
    }
  }

  static generate(_seed: string): Galaxy {
    // Placeholder: actual generation in GalaxySimulator
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

    // Reveal the system itself
    system.explored = true;
    system.fogOfWar = false;

    // Reveal all connected neighbors
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
}
