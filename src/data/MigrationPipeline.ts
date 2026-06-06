import type { SaveState } from "@/domain/SaveState";
import { logger } from "@/utils/logger";

export class MigrationPipeline {
  static readonly CURRENT_VERSION = 12;

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
    // 4 -> 5: hull classes (Task 5). Old saves lack hullClass on player.ship.
    4: (state: SaveState) => {
      const ship = (
        state.player as unknown as { ship?: { hullClass?: string } }
      )?.ship;
      if (ship && !ship.hullClass) {
        ship.hullClass = "CORVETTE";
      }
    },
    // 5 -> 6: micromodule inventory (Task 7). Old saves lack micromodules in player inventory.
    5: (state: SaveState) => {
      const inventory = (
        state.player as unknown as { inventory?: { micromodules?: unknown[] } }
      )?.inventory;
      if (inventory && !Array.isArray(inventory.micromodules)) {
        inventory.micromodules = [];
      }
    },
    // 6 -> 7: NPC questing and news feed (Task 13). Old saves lack activeQuestTarget
    // on NPC ships and the galaxy newsFeed array.
    6: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        npcShips?: Array<{ activeQuestTarget?: unknown }>;
        newsFeed?: unknown[];
      };
      if (galaxy) {
        if (!Array.isArray(galaxy.newsFeed)) {
          galaxy.newsFeed = [];
        }
        if (Array.isArray(galaxy.npcShips)) {
          for (const npc of galaxy.npcShips) {
            if (npc.activeQuestTarget === undefined) {
              npc.activeQuestTarget = null;
            }
          }
        }
      }
    },
    // 7 -> 8: Galaxy-spanning quest objectives (Task 14). Old saves lack
    // targetSystemId and targetObjectId on persisted active quests.
    7: (state: SaveState) => {
      const quests = (
        state.player as unknown as {
          questLog?: { activeQuests?: Array<Record<string, unknown>> };
        }
      )?.questLog?.activeQuests;
      if (Array.isArray(quests)) {
        for (const q of quests) {
          if (q.targetSystemId === undefined) q.targetSystemId = null;
          if (q.targetObjectId === undefined) q.targetObjectId = null;
        }
      }
    },
    // 8 -> 9: Quest board persistence (Task 15). Old saves lack questBoards on
    // galaxy; initialize to empty record so board tracking starts fresh.
    8: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { questBoards?: unknown };
      if (galaxy && !galaxy.questBoards) {
        galaxy.questBoards = {};
      }
    },
    // 9 -> 10: Reputation gates and quest chains (Task 16). Old saves lack
    // minReputation/chainId/chainPart on quests and completedQuestChains on player.
    9: (state: SaveState) => {
      const player = state.player as unknown as {
        completedQuestChains?: string[];
        questLog?: { activeQuests?: Array<Record<string, unknown>> };
      };
      if (player) {
        if (!Array.isArray(player.completedQuestChains)) {
          player.completedQuestChains = [];
        }
        const quests = player.questLog?.activeQuests;
        if (Array.isArray(quests)) {
          for (const q of quests) {
            if (q.minReputation === undefined) q.minReputation = 0;
            if (q.chainId === undefined) q.chainId = null;
            if (q.chainPart === undefined) q.chainPart = -1;
          }
        }
      }
    },
    // 11 -> 12: Data fog (Task 21). lastVisitedDay on StarSystem is optional;
    // undefined means "never visited" which is the correct default for old saves.
    11: (_state: SaveState) => {
      // No migration needed — field is optional with no required default value.
    },
    // 10 -> 11: News feed bookmarks (Task 20). Add newsBookmarks to player;
    // backfill description on legacy news events that lack it.
    10: (state: SaveState) => {
      const player = state.player as unknown as { newsBookmarks?: number[] };
      if (player && !Array.isArray(player.newsBookmarks)) {
        player.newsBookmarks = [];
      }
      const galaxy = state.galaxy as unknown as {
        newsFeed?: Array<{ description?: string }>;
      };
      if (galaxy && Array.isArray(galaxy.newsFeed)) {
        for (const event of galaxy.newsFeed) {
          if (!event.description) event.description = "";
        }
      }
    },
  };
}
