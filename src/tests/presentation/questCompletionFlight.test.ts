import { describe, it, expect, vi } from "vitest";
import { QuestCompletion } from "@/presentation/flight/QuestCompletion";
import { QuestType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

interface FakeQuest {
  id: string;
  title: string;
  type: QuestType;
  isCompleted: boolean;
  isFailed: boolean;
  targetSystemId?: string;
  targetObjectId?: string;
}

function makeEngine(quests: FakeQuest[]): {
  engine: GameEngine;
  forceComplete: ReturnType<typeof vi.fn>;
  tryLiberate: ReturnType<typeof vi.fn>;
} {
  const forceComplete = vi.fn().mockReturnValue(true);
  const tryLiberate = vi.fn().mockReturnValue(true);
  const engine = {
    player: { currentSystemId: "sys-1" },
    questManager: {
      getActiveQuests: () => quests,
      forceCompleteQuest: forceComplete,
    },
    galaxy: { tryLiberate },
  } as unknown as GameEngine;
  return { engine, forceComplete, tryLiberate };
}

const base = {
  isCompleted: false,
  isFailed: false,
};

describe("QuestCompletion (extracted from SpaceFlightScene)", () => {
  it("completes a matching EXPLORATION quest on system entry, ignores others", () => {
    const { engine, forceComplete } = makeEngine([
      {
        ...base,
        id: "q1",
        title: "Explore",
        type: QuestType.EXPLORATION,
        targetSystemId: "sys-1",
      },
      {
        ...base,
        id: "q2",
        title: "Other system",
        type: QuestType.EXPLORATION,
        targetSystemId: "sys-9",
      },
      {
        ...base,
        id: "q3",
        title: "Wrong type",
        type: QuestType.BOUNTY,
        targetSystemId: "sys-1",
      },
    ]);
    new QuestCompletion(engine).explorationBySystemEntry();
    expect(forceComplete).toHaveBeenCalledTimes(1);
    expect(forceComplete).toHaveBeenCalledWith("q1", expect.anything());
  });

  it("completes a BOUNTY quest matching the killed NPC id", () => {
    const { engine, forceComplete } = makeEngine([
      {
        ...base,
        id: "b1",
        title: "Kill",
        type: QuestType.BOUNTY,
        targetObjectId: "npc-7",
      },
      {
        ...base,
        id: "b2",
        title: "Other npc",
        type: QuestType.BOUNTY,
        targetObjectId: "npc-3",
      },
    ]);
    new QuestCompletion(engine).bountyByNpcKill("npc-7");
    expect(forceComplete).toHaveBeenCalledTimes(1);
    expect(forceComplete).toHaveBeenCalledWith("b1", expect.anything());
  });

  it("liberates the stored hostile system when a DEFENSE quest completes", () => {
    const { engine, forceComplete, tryLiberate } = makeEngine([
      {
        ...base,
        id: "d1",
        title: "Defend",
        type: QuestType.DEFENSE,
        targetSystemId: "sys-1",
        targetObjectId: "overmind-2",
      },
    ]);
    new QuestCompletion(engine).defenseBySystemEntry();
    expect(forceComplete).toHaveBeenCalledTimes(1);
    expect(tryLiberate).toHaveBeenCalledWith("overmind-2");
  });

  it("is a no-op with no game engine", () => {
    const qc = new QuestCompletion(null);
    expect(() => qc.explorationBySystemEntry()).not.toThrow();
    expect(() => qc.bountyByNpcKill("x")).not.toThrow();
    expect(() => qc.defenseBySystemEntry()).not.toThrow();
  });
});
