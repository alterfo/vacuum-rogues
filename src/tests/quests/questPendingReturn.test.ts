import { describe, it, expect } from "vitest";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType } from "@/types";
import { QuestSchema, QuestLogSchema } from "@/validation/schemas";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import type { SaveState } from "@/domain/SaveState";

const REWARD = {
  credits: 500,
  experience: 100,
  items: [] as { type: ResourceType; amount: number }[],
};

describe("Quest.isPendingReturn — field existence", () => {
  it("new quest starts with isPendingReturn=false", () => {
    const q = new Quest(
      "q1",
      "Test",
      QuestType.BOUNTY,
      [],
      REWARD,
      [],
      "planet_A",
      0,
      30,
    );
    expect(q.isPendingReturn).toBe(false);
  });

  it("isPendingReturn can be set to true", () => {
    const q = new Quest(
      "q2",
      "Test",
      QuestType.BOUNTY,
      [],
      REWARD,
      [],
      "planet_A",
      0,
      30,
    );
    q.isPendingReturn = true;
    expect(q.isPendingReturn).toBe(true);
  });
});

describe("Quest.isExpired with isPendingReturn", () => {
  it("quest with isPendingReturn=true never expires even past deadline", () => {
    const q = new Quest(
      "q3",
      "Охота",
      QuestType.BOUNTY,
      [],
      REWARD,
      [],
      "planet_A",
      0,
      10,
    );
    q.isPendingReturn = true;
    expect(q.isExpired(100)).toBe(false);
  });

  it("quest with isPendingReturn=false and expired deadline IS expired", () => {
    const q = new Quest(
      "q4",
      "Охота",
      QuestType.BOUNTY,
      [],
      REWARD,
      [],
      "planet_A",
      0,
      10,
    );
    expect(q.isPendingReturn).toBe(false);
    expect(q.isExpired(100)).toBe(true);
  });
});

describe("QuestSchema — isPendingReturn default", () => {
  it("parses quest without isPendingReturn and defaults to false", () => {
    const raw = {
      id: "q_test",
      title: "Test",
      type: "BOUNTY",
      objectives: [],
      isCompleted: false,
      isFailed: false,
      planetId: "p1",
      issuedDay: 0,
      deadline: 10,
      failurePenalty: null,
    };
    const parsed = QuestSchema.parse(raw);
    expect(parsed.isPendingReturn).toBe(false);
  });

  it("parses quest with isPendingReturn=true", () => {
    const raw = {
      id: "q_test2",
      title: "Test",
      type: "BOUNTY",
      objectives: [],
      isCompleted: false,
      isFailed: false,
      isPendingReturn: true,
      planetId: "p1",
      issuedDay: 0,
      deadline: 10,
      failurePenalty: null,
    };
    const parsed = QuestSchema.parse(raw);
    expect(parsed.isPendingReturn).toBe(true);
  });
});

describe("QuestLogSchema — pendingReturnQuests default", () => {
  it("parses questLog without pendingReturnQuests and defaults to []", () => {
    const raw = {
      activeQuests: [],
      completedQuests: [],
    };
    const parsed = QuestLogSchema.parse(raw);
    expect(parsed.pendingReturnQuests).toEqual([]);
  });
});

describe("MigrationPipeline v21→v22 — isPendingReturn backfill", () => {
  function makeSaveV21(): SaveState {
    return {
      version: 21,
      timestamp: 0,
      persistentDialogs: [],
      galaxy: {
        id: "g1",
        gameDays: 0,
        systems: [
          {
            id: "sys_A",
            name: "A",
            coordinates: { q: 0, r: 0 },
            starType: "YELLOW_DWARF",
            explored: true,
            fogOfWar: false,
          },
        ],
      } as unknown as SaveState["galaxy"],
      player: {
        id: "p1",
        name: "Player",
        experience: 0,
        level: 1,
        credits: 0,
        reputation: {},
        questLog: {
          activeQuests: [
            {
              id: "q_old",
              title: "Old quest",
              type: "BOUNTY",
              objectives: [],
              isCompleted: false,
              isFailed: false,
              planetId: "p",
              issuedDay: 0,
              deadline: 10,
              failurePenalty: null,
            },
          ],
          completedQuests: [],
        },
      } as unknown as SaveState["player"],
    } as unknown as SaveState;
  }

  it("migrates old save: adds isPendingReturn=false to active quests", () => {
    const state = makeSaveV21();
    MigrationPipeline.migrate(state);
    const quests = (
      state.player as unknown as {
        questLog: { activeQuests: Array<Record<string, unknown>> };
      }
    ).questLog.activeQuests;
    expect(quests[0].isPendingReturn).toBe(false);
  });

  it("migrates old save: adds pendingReturnQuests=[] to questLog", () => {
    const state = makeSaveV21();
    MigrationPipeline.migrate(state);
    const questLog = (
      state.player as unknown as {
        questLog: { pendingReturnQuests: unknown[] };
      }
    ).questLog;
    expect(Array.isArray(questLog.pendingReturnQuests)).toBe(true);
    expect(questLog.pendingReturnQuests).toHaveLength(0);
  });

  it("migration is idempotent: existing pendingReturnQuests not overwritten", () => {
    const state = makeSaveV21();
    const questLog = (
      state.player as unknown as {
        questLog: Record<string, unknown>;
      }
    ).questLog;
    questLog.pendingReturnQuests = [{ id: "q_existing" }];
    MigrationPipeline.migrate(state);
    const result = (
      state.player as unknown as {
        questLog: { pendingReturnQuests: unknown[] };
      }
    ).questLog.pendingReturnQuests;
    expect(result).toHaveLength(1);
  });
});
