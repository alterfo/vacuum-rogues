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
  /** The core OVERMIND system; destroying it triggers the win condition. */
  overmindCoreSystemId: string = "";

  constructor(
    public readonly id: string,
    public readonly systems: StarSystem[],
    public readonly overmind: Overmind,
    public readonly activeEvents: GalacticEvent[],
    /** Autonomous NPC ships living across the galaxy (Feature 8). */
    public readonly npcShips: NpcShip[] = [],
    overmindSystems: string[] = [],
    overmindCoreSystemId: string = "",
  ) {
    this.overmindSystems = overmindSystems;
    this.overmindCoreSystemId = overmindCoreSystemId;
  }

  /** Returns true if this system is currently controlled by OVERMIND. */
  isOvermindSystem(systemId: string): boolean {
    return this.overmindSystems.includes(systemId);
  }

  /** Returns true when OVERMIND controls more than half the galaxy (loss condition). */
  isOvermindMajority(): boolean {
    return this.overmindSystems.length > this.systems.length / 2;
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
