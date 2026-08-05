import { describe, it, expect } from "vitest";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { validateSaveState } from "@/validation/schemas";
import type { SaveState } from "@/domain/SaveState";

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

    expect(sys.economyType).toBe("MIXED");
    expect(sys.politicalSystem).toBe("REPUBLIC");

    expect(pl.contrabandGoods).toEqual([]);

    expect((pl.ship as Record<string, unknown>).hullClass).toBe("CORVETTE");

    expect((pl.inventory as Record<string, unknown>).micromodules).toEqual([]);

    expect(npcs[0].cargo).toEqual([]);
    expect(npcs[0].loadoutSummary).toEqual([]);
    expect(npcs[0].shieldPower).toBe(0);

    expect(gal.newsFeed).toEqual([]);
    expect(npcs[0].activeQuestTarget).toBeNull();

    expect(gal.questBoards).toEqual({});

    expect(pl.completedQuestChains).toEqual([]);

    expect(pl.activeTextQuestState).toBeNull();

    expect(pl.newsBookmarks).toEqual([]);

    expect(pl.killPoints).toBe(0);
    expect(pl.rank).toBe(0);

    expect(gal.overmindSystems).toEqual([]);
    expect(gal.overmindCoreSystemId).toBe("sys-1");

    expect(gal.pirateSystems).toEqual([]);

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
    const gal = twice.galaxy as unknown as Record<string, unknown>;
    expect((gal.systems as Record<string, unknown>[])[0].economyType).toBe(
      "MIXED",
    );
  });

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

    expect(() => validateSaveState(migrated)).not.toThrow();
  });

  it("adds empty pendingReturnQuests to questLog absent from old saves", () => {
    const raw = makeV0Save();
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

    const parsed = validateSaveState(migrated) as unknown as Record<
      string,
      unknown
    >;
    const parsedLog = (parsed.player as Record<string, unknown>)
      .questLog as Record<string, unknown>;
    expect(parsedLog.pendingReturnQuests).toEqual([]);
  });
});
