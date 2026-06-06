import { describe, it, expect } from "vitest";
import { QuestManager } from "@/systems/QuestManager";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType, EnemyType } from "@/types";
import type { Player } from "@/domain/Player";
import type { Reward } from "@/types";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

function playerStub(credits = 0): Player {
  const reputation: Record<string, number> = {};
  return {
    credits,
    experience: 0,
    contrabandGoods: [],
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

const EMPTY_REWARD: Reward = { credits: 300, experience: 100, items: [] };

function makeDeliveryQuest(
  targetSystemId: string,
  cargo: ResourceType,
  qty: number,
): Quest {
  return new Quest(
    "q_delivery_test",
    "Test Delivery",
    QuestType.DELIVERY,
    [
      {
        id: "obj_collect",
        description: "Load cargo",
        type: "COLLECT_ITEM",
        targetAmount: qty,
        currentAmount: 0,
        completed: false,
        itemType: cargo,
      },
      {
        id: "obj_deliver",
        description: "Deliver",
        type: "VISIT_LOCATION",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
        locationId: `${targetSystemId}_p1`,
      },
    ],
    EMPTY_REWARD,
    [],
    "origin_planet",
    0,
    10,
    null,
    targetSystemId,
    null,
  );
}

function makeBountyQuest(
  targetNpcId: string | null,
  targetSystemId = "sys_B",
): Quest {
  return new Quest(
    "q_bounty_test",
    "Test Bounty",
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
    EMPTY_REWARD,
    [],
    "origin_planet",
    0,
    10,
    null,
    targetSystemId,
    targetNpcId,
  );
}

function makeExplorationQuest(targetSystemId: string): Quest {
  return new Quest(
    "q_explore_test",
    "Test Exploration",
    QuestType.EXPLORATION,
    [
      {
        id: "obj_scan",
        description: "Scan system",
        type: "VISIT_LOCATION",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
        locationId: `${targetSystemId}_p1`,
      },
    ],
    EMPTY_REWARD,
    [],
    "origin_planet",
    0,
    10,
    null,
    targetSystemId,
    null,
  );
}

describe("Quest domain: targetSystemId and targetObjectId", () => {
  it("Quest stores targetSystemId and targetObjectId from constructor", () => {
    const q = makeDeliveryQuest("sys_B", ResourceType.METALS, 5);
    expect(q.targetSystemId).toBe("sys_B");
    expect(q.targetObjectId).toBeNull();
  });

  it("Quest defaults targetSystemId and targetObjectId to null", () => {
    const q = new Quest(
      "q_local",
      "Local",
      QuestType.DELIVERY,
      [],
      EMPTY_REWARD,
      [],
      "planet",
      0,
      0,
    );
    expect(q.targetSystemId).toBeNull();
    expect(q.targetObjectId).toBeNull();
  });
});

describe("QuestManager.forceCompleteQuest", () => {
  it("force-completes an active quest with incomplete objectives and grants reward", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeDeliveryQuest("sys_B", ResourceType.METALS, 5);
    qm["activeQuests"].set(quest.id, quest);

    const result = qm.forceCompleteQuest(quest.id, player);
    expect(result).toBe(true);
    expect(player.credits).toBe(EMPTY_REWARD.credits);
    expect(qm.getActiveQuests()).toHaveLength(0);
    expect(qm.getCompletedQuestIds()).toContain(quest.id);
  });

  it("returns false for unknown quest ids", () => {
    const qm = new QuestManager();
    const player = playerStub();
    expect(qm.forceCompleteQuest("does_not_exist", player)).toBe(false);
  });

  it("returns false for already-failed quests", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeDeliveryQuest("sys_B", ResourceType.METALS, 5);
    quest.markAsFailed();
    qm["activeQuests"].set(quest.id, quest);
    expect(qm.forceCompleteQuest(quest.id, player)).toBe(false);
  });
});

describe("DELIVERY quest auto-completion logic", () => {
  it("completes when player is in targetSystemId with required cargo", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const cargo = ResourceType.METALS;
    const qty = 8;
    player.inventory.resources.push({ type: cargo, amount: 10 });

    const quest = makeDeliveryQuest("sys_B", cargo, qty);
    qm["activeQuests"].set(quest.id, quest);

    // Simulate PlanetScene logic: check if player is in target system and has cargo
    const activeDelivery = qm
      .getActiveQuests()
      .filter(
        (q) =>
          q.type === QuestType.DELIVERY &&
          !q.isCompleted &&
          !q.isFailed &&
          q.targetSystemId === "sys_B",
      );
    expect(activeDelivery).toHaveLength(1);

    const collectObj = activeDelivery[0].objectives.find(
      (o) => o.type === "COLLECT_ITEM" && !o.completed,
    )!;
    const stack = player.inventory.resources.find(
      (r) => r.type === collectObj.itemType,
    )!;
    expect(stack.amount).toBeGreaterThanOrEqual(collectObj.targetAmount);
    stack.amount -= collectObj.targetAmount;

    const completed = qm.forceCompleteQuest(activeDelivery[0].id, player);
    expect(completed).toBe(true);
    expect(player.credits).toBe(EMPTY_REWARD.credits);
    expect(stack.amount).toBe(2); // 10 - 8
  });

  it("does NOT complete when player lacks sufficient cargo", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const cargo = ResourceType.METALS;
    player.inventory.resources.push({ type: cargo, amount: 3 }); // needs 8

    const quest = makeDeliveryQuest("sys_B", cargo, 8);
    qm["activeQuests"].set(quest.id, quest);

    // Simulate PlanetScene check
    const activeDelivery = qm
      .getActiveQuests()
      .filter(
        (q) =>
          q.type === QuestType.DELIVERY &&
          !q.isCompleted &&
          !q.isFailed &&
          q.targetSystemId === "sys_B",
      );
    const collectObj = activeDelivery[0].objectives.find(
      (o) => o.type === "COLLECT_ITEM" && !o.completed,
    )!;
    const stack = player.inventory.resources.find(
      (r) => r.type === collectObj.itemType,
    );
    const hasEnough = stack && stack.amount >= collectObj.targetAmount;
    expect(hasEnough).toBeFalsy();
    // No forceComplete called → still active
    expect(qm.getActiveQuests()).toHaveLength(1);
  });

  it("does NOT complete DELIVERY quests in the wrong system", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const cargo = ResourceType.METALS;
    player.inventory.resources.push({ type: cargo, amount: 10 });

    const quest = makeDeliveryQuest("sys_C", cargo, 5);
    qm["activeQuests"].set(quest.id, quest);

    const matches = qm
      .getActiveQuests()
      .filter(
        (q) => q.type === QuestType.DELIVERY && q.targetSystemId === "sys_B",
      );
    expect(matches).toHaveLength(0);
  });
});

describe("BOUNTY quest auto-completion on NPC kill", () => {
  it("completes bounty quest when killed npcId matches targetObjectId", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const npcId = "npc_pirate_42";

    const quest = makeBountyQuest(npcId, "sys_B");
    qm["activeQuests"].set(quest.id, quest);

    // Simulate SpaceFlightScene bounty check
    for (const q of qm.getActiveQuests()) {
      if (q.type !== QuestType.BOUNTY || q.isCompleted || q.isFailed) continue;
      if (
        q.targetObjectId === npcId ||
        (!q.targetObjectId && q.targetSystemId === "sys_B")
      ) {
        qm.forceCompleteQuest(q.id, player);
      }
    }

    expect(player.credits).toBe(EMPTY_REWARD.credits);
    expect(qm.getCompletedQuestIds()).toContain(quest.id);
  });

  it("completes bounty quest in target system even without specific targetObjectId", () => {
    const qm = new QuestManager();
    const player = playerStub();

    const quest = makeBountyQuest(null, "sys_B");
    qm["activeQuests"].set(quest.id, quest);

    const currentSystemId = "sys_B";
    for (const q of qm.getActiveQuests()) {
      if (q.type !== QuestType.BOUNTY || q.isCompleted || q.isFailed) continue;
      const matchesNpc = q.targetObjectId === "any_killed_npc";
      const matchesSystem =
        !q.targetObjectId && q.targetSystemId === currentSystemId;
      if (!matchesNpc && !matchesSystem) continue;
      qm.forceCompleteQuest(q.id, player);
    }

    expect(player.credits).toBe(EMPTY_REWARD.credits);
  });

  it("does NOT complete bounty quest for wrong npcId", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeBountyQuest("npc_target_1", "sys_B");
    qm["activeQuests"].set(quest.id, quest);

    // Different NPC killed, different system
    const killedNpcId = "npc_random_99";
    const currentSystem = "sys_A";
    for (const q of qm.getActiveQuests()) {
      if (q.type !== QuestType.BOUNTY || q.isCompleted || q.isFailed) continue;
      const matchesNpc = q.targetObjectId === killedNpcId;
      const matchesSystem =
        !q.targetObjectId && q.targetSystemId === currentSystem;
      if (!matchesNpc && !matchesSystem) continue;
      qm.forceCompleteQuest(q.id, player);
    }

    expect(player.credits).toBe(0); // not completed
    expect(qm.getActiveQuests()).toHaveLength(1);
  });
});

describe("EXPLORATION quest auto-completion on system entry", () => {
  it("completes exploration quest when entering targetSystemId", () => {
    const qm = new QuestManager();
    const player = playerStub();

    const quest = makeExplorationQuest("sys_C");
    qm["activeQuests"].set(quest.id, quest);

    const currentSystemId = "sys_C";
    for (const q of qm.getActiveQuests()) {
      if (q.type !== QuestType.EXPLORATION || q.isCompleted || q.isFailed)
        continue;
      if (q.targetSystemId !== currentSystemId) continue;
      qm.forceCompleteQuest(q.id, player);
    }

    expect(player.credits).toBe(EMPTY_REWARD.credits);
    expect(qm.getCompletedQuestIds()).toContain(quest.id);
  });

  it("does NOT complete exploration quest in wrong system", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeExplorationQuest("sys_C");
    qm["activeQuests"].set(quest.id, quest);

    const currentSystemId = "sys_A";
    for (const q of qm.getActiveQuests()) {
      if (q.type !== QuestType.EXPLORATION || q.isCompleted || q.isFailed)
        continue;
      if (q.targetSystemId !== currentSystemId) continue;
      qm.forceCompleteQuest(q.id, player);
    }

    expect(player.credits).toBe(0);
    expect(qm.getActiveQuests()).toHaveLength(1);
  });
});

describe("QuestManager.checkExpiredQuests — deadline expiry and penalties", () => {
  function makeTimedQuest(
    id: string,
    issuedDay: number,
    deadline: number,
    penalty: { reputationLoss: number; creditsFine?: number } | null,
  ): Quest {
    return new Quest(
      id,
      "Timed Quest",
      QuestType.DELIVERY,
      [],
      EMPTY_REWARD,
      [],
      "faction_A",
      issuedDay,
      deadline,
      penalty ? { ...penalty, description: "test penalty" } : null,
    );
  }

  it("removes expired quest from active list", () => {
    const qm = new QuestManager();
    const player = playerStub(1000);
    const quest = makeTimedQuest("q_expire_1", 0, 3, null);
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(10, player); // day 10 > issuedDay(0) + deadline(3)
    expect(qm.getActiveQuests()).toHaveLength(0);
  });

  it("does NOT expire quest within its deadline", () => {
    const qm = new QuestManager();
    const player = playerStub(1000);
    const quest = makeTimedQuest("q_expire_2", 0, 10, null);
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(5, player); // day 5 ≤ issuedDay(0) + deadline(10)
    expect(qm.getActiveQuests()).toHaveLength(1);
  });

  it("deducts credits fine on expiry", () => {
    const qm = new QuestManager();
    const player = playerStub(1000);
    const quest = makeTimedQuest("q_fine", 0, 2, {
      reputationLoss: 0,
      creditsFine: 200,
    });
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(5, player);
    expect(player.credits).toBe(800); // 1000 - 200
    expect(qm.getActiveQuests()).toHaveLength(0);
  });

  it("deducts reputation on expiry, clamped to -100", () => {
    const qm = new QuestManager();
    const player = playerStub(500);
    (player.reputation as Record<string, number>)["faction_A"] = -90;
    const quest = makeTimedQuest("q_rep", 0, 1, {
      reputationLoss: 30,
    });
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(5, player);
    // -90 - 30 = -120, clamped to -100
    expect(player.reputation["faction_A"]).toBe(-100);
  });

  it("does not expire quests with no deadline", () => {
    const qm = new QuestManager();
    const player = playerStub(500);
    const quest = makeTimedQuest("q_no_deadline", 0, 0, null);
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(9999, player); // any day
    expect(qm.getActiveQuests()).toHaveLength(1);
  });

  it("board generates 3-5 quests and accept moves quest to active", () => {
    const systems: StarSystem[] = [
      {
        id: "sys_A",
        name: "A",
        connections: [
          { fromSystemId: "sys_A", toSystemId: "sys_B", fuelCost: 5 },
        ],
        planets: [{ id: "sys_A_p1", isHabitable: true }],
      } as unknown as StarSystem,
      {
        id: "sys_B",
        name: "B",
        connections: [
          { fromSystemId: "sys_B", toSystemId: "sys_A", fuelCost: 5 },
        ],
        planets: [{ id: "sys_B_p1", isHabitable: true }],
      } as unknown as StarSystem,
    ];

    const board = generateQuestBoard({
      systems,
      originSystemId: "sys_A",
      planetId: "sys_A_p1",
      day: 0,
      seed: "test-seed",
      count: 5,
    });
    expect(board.length).toBeGreaterThanOrEqual(3);
    expect(board.length).toBeLessThanOrEqual(8); // count=5 but up to count

    const qm = new QuestManager();
    const accepted = qm.acceptQuestFromTemplate(
      board[0].template,
      "sys_A_p1",
      0,
    );
    expect(accepted).not.toBeNull();
    expect(qm.getActiveQuests()).toHaveLength(1);
    expect(qm.getActiveQuests()[0].id).toBe(board[0].template.id);
  });
});

describe("QuestGenerator wires targetSystemId into template", () => {
  function sys(id: string, toIds: string[]): StarSystem {
    return {
      id,
      name: id,
      connections: toIds.map((toSystemId) => ({
        fromSystemId: id,
        toSystemId,
        fuelCost: 5,
      })),
      planets: [{ id: `${id}_p1`, isHabitable: true }],
    } as unknown as StarSystem;
  }

  it("routine quests carry targetSystemId matching the target system", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A", "C"]), sys("C", ["B"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "test-seed",
      count: 30,
      textRatio: 0,
    });
    for (const q of board) {
      expect(q.template.targetSystemId).toBeDefined();
      expect(q.template.targetSystemId).not.toBeNull();
      expect(q.template.targetSystemId).not.toBe("A"); // always remote
    }
  });

  it("accepted quest stores targetSystemId from generator template", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "test-seed2",
      count: 10,
      textRatio: 0,
    });
    const qm = new QuestManager();
    const accepted = board
      .map((q) => qm.acceptQuestFromTemplate(q.template, "A_p1", 0))
      .filter(Boolean) as Quest[];

    for (let i = 0; i < accepted.length; i++) {
      expect(accepted[i].targetSystemId).toBe(board[i].targetSystemId);
    }
  });
});
