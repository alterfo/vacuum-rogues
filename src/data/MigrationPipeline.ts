import type { SaveState } from "@/domain/SaveState";
import { logger } from "@/utils/logger";

export class MigrationPipeline {
  static readonly CURRENT_VERSION = 4;

  static migrate(state: SaveState): SaveState {
    const fromVersion = state.version ?? 0;
    if (fromVersion >= MigrationPipeline.CURRENT_VERSION) {
      return state;
    }

    logger.info(
      `Migrating save from version ${fromVersion} to ${MigrationPipeline.CURRENT_VERSION}`,
    );

    for (let v = fromVersion; v < MigrationPipeline.CURRENT_VERSION; v++) {
      const migrator = this.migrations[v];
      if (migrator) {
        migrator(state);
      }
    }

    state.version = MigrationPipeline.CURRENT_VERSION;
    return state;
  }

  private static migrations: Record<number, (state: SaveState) => void> = {
    // Example migration from 0 -> 1
    0: (state: SaveState) => {
      // Initialize any missing fields for v1 schema
      if (!state.persistentDialogs) {
        state.persistentDialogs = [];
      }
    },
    // 1 -> 2: living-galaxy NPC ships (Feature 8). Old saves predate the NPC
    // population; start them empty so the simulation can repopulate going
    // forward without breaking the loaded galaxy.
    1: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { npcShips?: unknown[] };
      if (galaxy && !Array.isArray(galaxy.npcShips)) {
        galaxy.npcShips = [];
      }
    },
    // 2 -> 3: economy type and political system (Task 1). Old saves don't have
    // these fields; default to MIXED/REPUBLIC so every system is functional.
    2: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        systems?: Array<{ economyType?: string; politicalSystem?: string }>;
      };
      if (galaxy && Array.isArray(galaxy.systems)) {
        for (const sys of galaxy.systems) {
          if (!sys.economyType) sys.economyType = "MIXED";
          if (!sys.politicalSystem) sys.politicalSystem = "REPUBLIC";
        }
      }
    },
    // 3 -> 4: smuggling (Task 3). Old saves lack contrabandGoods on player.
    3: (state: SaveState) => {
      const player = state.player as unknown as { contrabandGoods?: string[] };
      if (player && !Array.isArray(player.contrabandGoods)) {
        player.contrabandGoods = [];
      }
    },
  };
}
