import { describe, it, expect } from "vitest";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { validateSaveState } from "@/validation/schemas";
import type { SaveState } from "@/domain/SaveState";

/** Minimal v0 save — only the fields that existed before any plan tasks. */
function makeV0Save(): Record<string, unknown> {
  return {
    version: 1, // version 1 is the first "real" save (v0 lacked persistentDialogs)
    timestamp: 1_000_000,
    persistentDialogs: [],
    galaxy: {
      id: "galaxy-test",
      gameDays: 3,
      systems: [
        {
          id: "sys-1",
          name: "Alpha",
          coordinates: { q: 0, r: 0 },
          starType: "YELLOW_DWARF",
          explored: true,
          fogOfWar: false,
          planets: [],
          connections: [],
        },
      ],
      npcShips: [
        {
          id: "npc-1",
          name: "Trader",
          race: "OUTLANDERS",
          faction: "OUTLANDERS",
          role: "TRADER",
          hullHP: 100,
          maxHull: 100,
          shields: 0,
          speed: 0.5,
          damage: 10,
          currentSystemId: "sys-1",
          state: "IDLE",
          goal: null,
          destinationSystemId: null,
          daysToArrival: 0,
          credits: 500,
          reputation: 0,
        },
      ],
    },
    player: {
      id: "player-1",
      name: "Tester",
      experience: 0,
      level: 1,
      credits: 1000,
      reputation: {},
      questLog: { activeQuests: [], completedQuests: [] },
      journal: { entries: [] },
      currentSystemId: "sys-1",
      ship: {
        id: "Ranger-1",
        name: "Ranger-1",
        hullHP: 100,
        maxHull: 100,
        shields: 50,
        maxShields: 50,
        energy: 100,
        maxEnergy: 100,
        speed: 1.0,
        evasion: 0.8,
        modules: [null, null, null],
      },
      inventory: { modules: [], resources: [], cosmetics: [] },
    },
  };
}

/**
 * A quest object as it appeared in a save predating the quest-polish plan:
 * no `isPendingReturn`, no `targetSystemId`/`minReputation`/`chainId` etc.
 * The migration pipeline must backfill these without dropping the quest.
 */
function makeLegacyQuest(): Record<string, unknown> {
  return {
    id: "quest_bounty_hunt",
    title: "Bounty Hunt",
    type: "BOUNTY",
    objectives: [
      {
        id: "obj-1",
        description: "Destroy the target ship",
        type: "DEFEAT_ENEMY",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
      },
    ],
    isCompleted: false,
    isFailed: false,
    planetId: "planet-1",
    issuedDay: 1,
    deadline: 0,
    failurePenalty: null,
    // NOTE: deliberately omits isPendingReturn to simulate an old save.
  };
}

describe("MigrationPipeline", () => {
  it("migrates from version 1 to current and adds all Task 1–24 defaults", () => {
    const raw = makeV0Save();
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);

    const gal = migrated.galaxy as unknown as Record<string, unknown>;
    const sys = (gal.systems as Record<string, unknown>[])[0];
    const npcs = gal.npcShips as Record<string, unknown>[];
    const pl = migrated.player as unknown as Record<string, unknown>;

    // Task 1: economy + political system defaults
    expect(sys.economyType).toBe("MIXED");
    expect(sys.politicalSystem).toBe("REPUBLIC");

    // Task 3: contraband goods
    expect(pl.contrabandGoods).toEqual([]);

    // Task 5: hull class
    expect((pl.ship as Record<string, unknown>).hullClass).toBe("CORVETTE");

    // Task 7: micromodules in inventory
    expect((pl.inventory as Record<string, unknown>).micromodules).toEqual([]);

    // Tasks 8/12: NPC ship fields filled by v14→v15 migration
    expect(npcs[0].cargo).toEqual([]);
    expect(npcs[0].loadoutSummary).toEqual([]);
    expect(npcs[0].shieldPower).toBe(0);

    // Task 13: news feed + activeQuestTarget
    expect(gal.newsFeed).toEqual([]);
    expect(npcs[0].activeQuestTarget).toBeNull();

    // Task 15: quest boards
    expect(gal.questBoards).toEqual({});

    // Task 16: completed quest chains
    expect(pl.completedQuestChains).toEqual([]);

    // Task 17: active text quest state (fixed in v14→v15)
    expect(pl.activeTextQuestState).toBeNull();

    // Task 20: news bookmarks
    expect(pl.newsBookmarks).toEqual([]);

    // Task 22: kill points + rank
    expect(pl.killPoints).toBe(0);
    expect(pl.rank).toBe(0);

    // Task 23: OVERMIND systems
    expect(gal.overmindSystems).toEqual([]);
    expect(gal.overmindCoreSystemId).toBe("sys-1");

    // Task 25 (overmind balance): pirate-held systems
    expect(gal.pirateSystems).toEqual([]);

    // Task 24: trade boom systems (fixed in v14→v15)
    expect(gal.activeTradeBoomSystems).toEqual({});
  });

  it("migrated save passes Zod schema validation", () => {
    const raw = makeV0Save();
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
    expect(() => validateSaveState(migrated)).not.toThrow();
  });

  it("is idempotent — migrating an already-current save is a no-op", () => {
    const raw = makeV0Save();
    const once = MigrationPipeline.migrate(raw as unknown as SaveState);
    const twice = MigrationPipeline.migrate(once);
    expect(twice.version).toBe(MigrationPipeline.CURRENT_VERSION);
    // No fields should be corrupted by double migration
    const gal = twice.galaxy as unknown as Record<string, unknown>;
    expect((gal.systems as Record<string, unknown>[])[0].economyType).toBe(
      "MIXED",
    );
  });

  // Task 8 (quest polish): quest-return persistence — v21→v22 migration.
  it("backfills isPendingReturn = false on legacy active quests", () => {
    const raw = makeV0Save();
    (raw.player as Record<string, unknown>).questLog = {
      activeQuests: [makeLegacyQuest()],
      completedQuests: [],
    };
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const pl = migrated.player as unknown as Record<string, unknown>;
    const questLog = pl.questLog as Record<string, unknown>;
    const quests = questLog.activeQuests as Record<string, unknown>[];
    expect(quests[0].isPendingReturn).toBe(false);

    // The migrated save must still satisfy the Zod schema.
    expect(() => validateSaveState(migrated)).not.toThrow();
  });

  it("adds empty pendingReturnQuests to questLog absent from old saves", () => {
    const raw = makeV0Save();
    // makeV0Save's questLog has no pendingReturnQuests key at all.
    expect(
      (
        (raw.player as Record<string, unknown>).questLog as Record<
          string,
          unknown
        >
      ).pendingReturnQuests,
    ).toBeUndefined();

    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const pl = migrated.player as unknown as Record<string, unknown>;
    const questLog = pl.questLog as Record<string, unknown>;
    expect(questLog.pendingReturnQuests).toEqual([]);

    // After validation the field is present and empty.
    const parsed = validateSaveState(migrated) as unknown as Record<
      string,
      unknown
    >;
    const parsedLog = (parsed.player as Record<string, unknown>)
      .questLog as Record<string, unknown>;
    expect(parsedLog.pendingReturnQuests).toEqual([]);
  });
});
