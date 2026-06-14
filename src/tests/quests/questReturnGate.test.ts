import { describe, it, expect } from "vitest";
import { QuestManager } from "@/systems/QuestManager";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType, EnemyType } from "@/types";
import type { Player } from "@/domain/Player";
import type { Reward } from "@/types";

const REWARD: Reward = { credits: 500, experience: 100, items: [] };

function playerStub(credits = 0): Player {
  const reputation: Record<string, number> = {};
  return {
    credits,
    experience: 0,
    contrabandGoods: [],
    completedQuestChains: [] as string[],
    inventory: {
      resources: [] as { type: ResourceType; amount: number }[],
      modules: [],
      micromodules: [],
      cosmetics: [],
    },
    reputation,
    getReputation: (id: string) => reputation[id] ?? 0,
    adjustReputation: (id: string, delta: number) => {
      reputation[id] = Math.max(
        -100,
        Math.min(100, (reputation[id] ?? 0) + delta),
      );
    },
  } as unknown as Player;
}

function makeBountyQuest(
  id = "q_bounty",
  planetId = "planet_origin",
  targetSystemId = "sys_B",
): Quest {
  return new Quest(
    id,
    "Bounty Hunt",
    QuestType.BOUNTY,
    [
      {
        id: "obj_kill",
        description: "Kill target",
        type: "DEFEAT_ENEMY",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
        enemyType: EnemyType.FIGHTER,
      },
    ],
    REWARD,
    [],
    planetId,
    0,
    20,
    null,
    targetSystemId,
    "npc_target_1",
  );
}

function makeEscortQuest(id = "q_escort", planetId = "planet_origin"): Quest {
  return new Quest(
    id,
    "Escort Convoy",
    QuestType.ESCORT,
    [
      {
        id: "obj_escort",
        description: "Reach target system",
        type: "VISIT_SYSTEM",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
        targetSystemId: "sys_C",
      },
    ],
    REWARD,
    [],
    planetId,
    0,
    15,
    null,
    "sys_C",
    null,
  );
}

describe("QuestManager.markObjectivesDone", () => {
  it("moves quest to pendingReturn, does NOT grant credits", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeBountyQuest();
    qm["activeQuests"].set(quest.id, quest);

    const result = qm.markObjectivesDone(quest.id);
    expect(result).toBe(true);
    expect(player.credits).toBe(0); // no reward granted
    expect(quest.isPendingReturn).toBe(true);
    expect(quest.isCompleted).toBe(false);
    expect(qm.getActiveQuests()).toHaveLength(0);
    expect(qm.getPendingReturnQuests()).toHaveLength(1);
    expect(qm.getCompletedQuestIds()).not.toContain(quest.id);
  });

  it("returns false for unknown quest id", () => {
    const qm = new QuestManager();
    expect(qm.markObjectivesDone("no_such_quest")).toBe(false);
  });

  it("returns false for already-failed quest", () => {
    const qm = new QuestManager();
    const quest = makeBountyQuest();
    quest.markAsFailed();
    qm["activeQuests"].set(quest.id, quest);
    expect(qm.markObjectivesDone(quest.id)).toBe(false);
  });

  it("marks all objectives as completed", () => {
    const qm = new QuestManager();
    const quest = makeBountyQuest();
    qm["activeQuests"].set(quest.id, quest);
    qm.markObjectivesDone(quest.id);
    for (const obj of quest.objectives) {
      expect(obj.completed).toBe(true);
    }
  });
});

describe("QuestManager.getPendingReturnQuests", () => {
  it("returns quest after markObjectivesDone", () => {
    const qm = new QuestManager();
    const quest = makeBountyQuest();
    qm["activeQuests"].set(quest.id, quest);
    qm.markObjectivesDone(quest.id);
    const pending = qm.getPendingReturnQuests();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(quest.id);
  });

  it("returns empty array when no pending-return quests", () => {
    const qm = new QuestManager();
    expect(qm.getPendingReturnQuests()).toHaveLength(0);
  });

  it("returns multiple pending quests", () => {
    const qm = new QuestManager();
    const q1 = makeBountyQuest("q1", "planet_A");
    const q2 = makeEscortQuest("q2", "planet_A");
    qm["activeQuests"].set(q1.id, q1);
    qm["activeQuests"].set(q2.id, q2);
    qm.markObjectivesDone(q1.id);
    qm.markObjectivesDone(q2.id);
    expect(qm.getPendingReturnQuests()).toHaveLength(2);
  });
});

describe("QuestManager.claimReturnReward", () => {
  it("grants credits and moves quest to completedQuests", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeBountyQuest();
    qm["activeQuests"].set(quest.id, quest);
    qm.markObjectivesDone(quest.id);

    const result = qm.claimReturnReward(quest.id, player);
    expect(result).toBe(true);
    expect(player.credits).toBe(REWARD.credits);
    expect(player.experience).toBe(REWARD.experience);
    expect(qm.getPendingReturnQuests()).toHaveLength(0);
    expect(qm.getCompletedQuestIds()).toContain(quest.id);
    expect(quest.isCompleted).toBe(true);
    expect(quest.isPendingReturn).toBe(false);
  });

  it("returns false for unknown quest id", () => {
    const qm = new QuestManager();
    const player = playerStub();
    expect(qm.claimReturnReward("no_such_quest", player)).toBe(false);
  });

  it("grants item rewards", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const rewardWithItems: Reward = {
      credits: 100,
      experience: 50,
      items: [{ type: ResourceType.METALS, amount: 5 }],
    };
    const quest = new Quest(
      "q_items",
      "Item Reward",
      QuestType.EXPLORATION,
      [],
      rewardWithItems,
      [],
      "planet_A",
      0,
      10,
      null,
      "sys_B",
      null,
    );
    qm["pendingReturnQuests"].set(quest.id, quest);
    qm.claimReturnReward(quest.id, player);
    const metals = player.inventory.resources.find(
      (r) => r.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(5);
  });

  it("does not double-count if called twice", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeBountyQuest();
    qm["activeQuests"].set(quest.id, quest);
    qm.markObjectivesDone(quest.id);

    qm.claimReturnReward(quest.id, player);
    const result2 = qm.claimReturnReward(quest.id, player);
    expect(result2).toBe(false); // already removed from pendingReturnQuests
    expect(player.credits).toBe(REWARD.credits); // only granted once
  });
});

describe("QuestManager.restoreState with pendingReturnQuests", () => {
  it("restores pending-return quests from save", () => {
    const qm = new QuestManager();
    const quest = makeBountyQuest();
    quest.isPendingReturn = true;
    qm.restoreState([], [], {}, [quest]);
    const pending = qm.getPendingReturnQuests();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(quest.id);
    expect(typeof pending[0].isExpired).toBe("function"); // prototype restored
  });

  it("restores empty pending when not provided", () => {
    const qm = new QuestManager();
    qm.restoreState([], [], {});
    expect(qm.getPendingReturnQuests()).toHaveLength(0);
  });
});

describe("QuestManager re-acceptance guard for pending-return quests", () => {
  function bountyTemplate(id = "tpl_bounty") {
    return {
      id,
      title: "Bounty Hunt",
      description: "Kill the target",
      type: QuestType.BOUNTY,
      objectives: [
        {
          id: "obj_kill",
          description: "Kill target",
          type: "DEFEAT_ENEMY" as const,
          targetAmount: 1,
          enemyType: EnemyType.FIGHTER,
        },
      ],
      reward: REWARD,
      dialogueAnchors: [],
      deadline: 20,
      failurePenalty: null,
      targetSystemId: "sys_B",
      targetObjectId: "npc_target_1",
    };
  }

  it("acceptQuest refuses an id already in pending-return (no duplicate)", () => {
    const qm = new QuestManager();
    const tpl = bountyTemplate();
    const accepted = qm.acceptQuestFromTemplate(tpl, "planet_origin");
    expect(accepted).not.toBeNull();

    // Objectives done in flight → quest moves to pending-return.
    qm.markObjectivesDone(tpl.id);
    expect(qm.getActiveQuests()).toHaveLength(0);
    expect(qm.getPendingReturnQuests()).toHaveLength(1);

    // The board would re-offer the same template id; re-accepting must be refused.
    const reAccepted = qm.acceptQuestFromTemplate(tpl, "planet_origin");
    expect(reAccepted).toBeNull();
    // No duplicate id across the two collections.
    expect(qm.getActiveQuests()).toHaveLength(0);
    expect(qm.getPendingReturnQuests()).toHaveLength(1);
  });
});

describe("QuestManager.claimReturnReward chain completion", () => {
  function chainQuest(part: number, chainId = "chain_x"): Quest {
    return new Quest(
      `q_chain_${part}`,
      `Chain part ${part}`,
      QuestType.EXPLORATION,
      [],
      REWARD,
      [],
      "planet_A",
      0,
      10,
      null,
      "sys_B",
      null,
      0,
      chainId,
      part,
    );
  }

  it("marks the chain complete on the player once all 3 parts are claimed", () => {
    const qm = new QuestManager();
    const player = playerStub();
    for (const part of [0, 1, 2]) {
      const q = chainQuest(part);
      qm["pendingReturnQuests"].set(q.id, q);
      qm.claimReturnReward(q.id, player);
    }
    expect(player.completedQuestChains).toContain("chain_x");
  });

  it("does NOT mark the chain complete after only a partial claim", () => {
    const qm = new QuestManager();
    const player = playerStub();
    for (const part of [0, 1]) {
      const q = chainQuest(part);
      qm["pendingReturnQuests"].set(q.id, q);
      qm.claimReturnReward(q.id, player);
    }
    expect(player.completedQuestChains).not.toContain("chain_x");
  });
});

describe("BOUNTY return-gate integration: bountyByNpcKill flow", () => {
  it("markObjectivesDone after NPC kill leaves credits unchanged", () => {
    const qm = new QuestManager();
    const player = playerStub(1000);
    const quest = makeBountyQuest("q_b", "planet_origin", "sys_B");
    qm["activeQuests"].set(quest.id, quest);

    // Simulate what QuestCompletion.bountyByNpcKill does
    const npcId = "npc_target_1";
    for (const q of qm.getActiveQuests()) {
      if (
        q.type !== QuestType.BOUNTY ||
        q.isCompleted ||
        q.isFailed ||
        q.isPendingReturn
      )
        continue;
      const matchesNpc = q.targetObjectId === npcId;
      if (!matchesNpc) continue;
      qm.markObjectivesDone(q.id);
    }

    expect(player.credits).toBe(1000); // no reward yet
    expect(qm.getPendingReturnQuests()).toHaveLength(1);

    // Then player returns to planet and claims reward
    const claimed = qm.claimReturnReward(quest.id, player);
    expect(claimed).toBe(true);
    expect(player.credits).toBe(1000 + REWARD.credits);
  });
});
