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
  isPendingReturn?: boolean;
  targetSystemId?: string;
  targetObjectId?: string;
}

function makeEngine(quests: FakeQuest[]): {
  engine: GameEngine;
  markDone: ReturnType<typeof vi.fn>;
  tryLiberate: ReturnType<typeof vi.fn>;
} {
  const markDone = vi.fn().mockReturnValue(true);
  const tryLiberate = vi.fn().mockReturnValue(true);
  const engine = {
    player: { currentSystemId: "sys-1" },
    questManager: {
      getActiveQuests: () => quests,
      markObjectivesDone: markDone,
    },
    galaxy: { tryLiberate },
    questPendingReturnCallback: undefined,
  } as unknown as GameEngine;
  return { engine, markDone, tryLiberate };
}

const base = {
  isCompleted: false,
  isFailed: false,
};

describe("QuestCompletion (extracted from SpaceFlightScene)", () => {
  it("marks pending-return for matching EXPLORATION quest on system entry, ignores others", () => {
    const { engine, markDone } = makeEngine([
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
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(markDone).toHaveBeenCalledWith("q1");
  });

  it("marks pending-return for BOUNTY quest matching the killed NPC id", () => {
    const { engine, markDone } = makeEngine([
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
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(markDone).toHaveBeenCalledWith("b1");
  });

  it("completes a bounty via system fallback when its bound target left the galaxy (killed off-screen)", () => {
    const markDone = vi.fn().mockReturnValue(true);
    const engine = {
      player: { currentSystemId: "sys-1" },
      questManager: {
        getActiveQuests: () => [
          {
            ...base,
            id: "b-gone",
            title: "Bounty: target gone",
            type: QuestType.BOUNTY,
            targetObjectId: "npc-bound",
            targetSystemId: "sys-1",
          },
        ],
        markObjectivesDone: markDone,
      },
      // npc-bound is NOT present — it was killed off-screen by another NPC.
      galaxy: { npcShips: [{ id: "npc-other" }] },
      questPendingReturnCallback: undefined,
    } as unknown as GameEngine;

    // Player kills a different pirate in the target system.
    new QuestCompletion(engine).bountyByNpcKill("npc-other");
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(markDone).toHaveBeenCalledWith("b-gone");
  });

  it("does NOT complete a bounty via system fallback while its bound target is still alive in the galaxy", () => {
    const markDone = vi.fn().mockReturnValue(true);
    const engine = {
      player: { currentSystemId: "sys-1" },
      questManager: {
        getActiveQuests: () => [
          {
            ...base,
            id: "b-alive",
            title: "Bounty: target alive",
            type: QuestType.BOUNTY,
            targetObjectId: "npc-bound",
            targetSystemId: "sys-1",
          },
        ],
        markObjectivesDone: markDone,
      },
      galaxy: { npcShips: [{ id: "npc-bound" }, { id: "npc-other" }] },
      questPendingReturnCallback: undefined,
    } as unknown as GameEngine;

    // Killing a different pirate must NOT satisfy a bounty bound to a live target.
    new QuestCompletion(engine).bountyByNpcKill("npc-other");
    expect(markDone).not.toHaveBeenCalled();
  });

  it("liberates the stored hostile system when a DEFENSE quest objectives are done", () => {
    const { engine, markDone, tryLiberate } = makeEngine([
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
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(tryLiberate).toHaveBeenCalledWith("overmind-2");
  });

  it("marks pending-return for matching ESCORT quest when convoy arrives at target system", () => {
    const { engine, markDone } = makeEngine([
      {
        ...base,
        id: "e1",
        title: "Escort convoy",
        type: QuestType.ESCORT,
        targetSystemId: "sys-1",
      },
      {
        ...base,
        id: "e2",
        title: "Wrong system",
        type: QuestType.ESCORT,
        targetSystemId: "sys-9",
      },
      {
        ...base,
        id: "e3",
        title: "Wrong type",
        type: QuestType.EXPLORATION,
        targetSystemId: "sys-1",
      },
    ]);
    new QuestCompletion(engine).escortBySystemEntry();
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(markDone).toHaveBeenCalledWith("e1");
  });

  it("is a no-op with no game engine", () => {
    const qc = new QuestCompletion(null);
    expect(() => qc.explorationBySystemEntry()).not.toThrow();
    expect(() => qc.bountyByNpcKill("x")).not.toThrow();
    expect(() => qc.defenseBySystemEntry()).not.toThrow();
    expect(() => qc.escortBySystemEntry()).not.toThrow();
  });
});
