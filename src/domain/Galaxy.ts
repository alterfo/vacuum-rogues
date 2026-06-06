import type { StarSystem } from "./StarSystem";
import type { Overmind } from "./Overmind";
import type { GalacticEvent } from "./GalacticEvent";
import type { NpcShip } from "./NpcShip";
import type { NewsEvent } from "@/types";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { logger } from "@/utils/logger";

/** Maximum number of news events retained in the feed. */
const NEWS_FEED_MAX = 50;

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

  constructor(
    public readonly id: string,
    public readonly systems: StarSystem[],
    public readonly overmind: Overmind,
    public readonly activeEvents: GalacticEvent[],
    /** Autonomous NPC ships living across the galaxy (Feature 8). */
    public readonly npcShips: NpcShip[] = [],
  ) {}

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
