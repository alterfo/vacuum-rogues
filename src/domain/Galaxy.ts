import type { StarSystem } from "./StarSystem";
import type { Overmind } from "./Overmind";
import type { GalacticEvent } from "./GalacticEvent";
import type { NpcShip } from "./NpcShip";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { logger } from "@/utils/logger";

export class Galaxy {
  gameDays = 0;

  constructor(
    public readonly id: string,
    public readonly systems: StarSystem[],
    public readonly overmind: Overmind,
    public readonly activeEvents: GalacticEvent[],
    /** Autonomous NPC ships living across the galaxy (Feature 8). */
    public readonly npcShips: NpcShip[] = [],
  ) {}

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
