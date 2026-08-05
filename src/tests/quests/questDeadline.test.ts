import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { QuestManager } from "@/systems/QuestManager";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType } from "@/types";
import type { Player } from "@/domain/Player";

function sys(id: string, toIds: string[]): StarSystem {
  return {
    id,
    name: id,
    connections: toIds.map((t) => ({
      fromSystemId: id,
      toSystemId: t,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
  } as unknown as StarSystem;
}

function playerStub(): Player {
  const reputation: Record<string, number> = {};
  return {
    credits: 1000,
    experience: 0,
    contrabandGoods: [],
    inventory: { resources: [], modules: [], micromodules: [], cosmetics: [] },
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

const EMPTY_REWARD = {
  credits: 100,
  experience: 50,
  items: [] as { type: ResourceType; amount: number }[],
};

describe("QuestGenerator deadline formula", () => {
  it("1-jump quests have deadline >= 30 days", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A"])];
    for (let i = 0; i < 5; i++) {
      const board = generateQuestBoard({
        systems,
        originSystemId: "A",
        planetId: "A_p1",
        day: i * 10,
        seed: `deadline-seed-${i}`,
        count: 30,
        textRatio: 0,
      });
      const oneJump = board.filter(
        (q) => q.jumps === 1 && q.template.deadline > 0,
      );
      for (const q of oneJump) {
        expect(q.template.deadline).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("2-jump quests have deadline >= 45 days", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A", "C"]), sys("C", ["B"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "deadline-2j",
      count: 30,
      textRatio: 0,
    });
    const twoJump = board.filter(
      (q) => q.jumps === 2 && q.template.deadline > 0,
    );
    expect(twoJump.length).toBeGreaterThan(0);
    for (const q of twoJump) {
      expect(q.template.deadline).toBeGreaterThanOrEqual(45);
    }
  });

  it("ESCORT 1-jump quests have deadline >= 30 days", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "deadline-escort",
      count: 60,
      textRatio: 0,
    });
    const escort = board.filter(
      (q) =>
        q.template.type === QuestType.ESCORT &&
        q.jumps === 1 &&
        q.template.deadline > 0,
    );
    for (const q of escort) {
      expect(q.template.deadline).toBeGreaterThanOrEqual(30);
    }
  });

  it("EXPLORATION 1-hop quests have deadline >= 30 days", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "deadline-explore",
      count: 60,
      textRatio: 0,
    });
    const explore = board.filter(
      (q) =>
        q.template.type === QuestType.EXPLORATION &&
        q.jumps === 1 &&
        q.template.deadline > 0,
    );
    for (const q of explore) {
      expect(q.template.deadline).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("QuestManager expiry feedback", () => {
  it("checkExpiredQuests returns the newly-expired quests", () => {
    const qm = new QuestManager();
    const quest = new Quest(
      "q_expiry_ret",
      "Доставка груза",
      QuestType.DELIVERY,
      [],
      EMPTY_REWARD,
      [],
      "planet_A",
      0,
      5,
      null,
    );
    qm["activeQuests"].set(quest.id, quest);

    const expired = qm.checkExpiredQuests(10, playerStub());
    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe("q_expiry_ret");
    expect(expired[0].title).toBe("Доставка груза");
  });

  it("checkExpiredQuests returns empty array when no quests expire", () => {
    const qm = new QuestManager();
    const quest = new Quest(
      "q_alive",
      "Живой квест",
      QuestType.DELIVERY,
      [],
      EMPTY_REWARD,
      [],
      "planet_A",
      0,
      30,
      null,
    );
    qm["activeQuests"].set(quest.id, quest);

    const expired = qm.checkExpiredQuests(5, playerStub());
    expect(expired).toHaveLength(0);
    expect(qm.getActiveQuests()).toHaveLength(1);
  });

  it("getExpiredQuests returns failed quests accumulated across multiple calls", () => {
    const qm = new QuestManager();
    const q1 = new Quest(
      "q_fail_1",
      "Квест А",
      QuestType.DELIVERY,
      [],
      EMPTY_REWARD,
      [],
      "p",
      0,
      3,
      null,
    );
    const q2 = new Quest(
      "q_fail_2",
      "Квест Б",
      QuestType.ESCORT,
      [],
      EMPTY_REWARD,
      [],
      "p",
      0,
      5,
      null,
    );
    qm["activeQuests"].set(q1.id, q1);
    qm["activeQuests"].set(q2.id, q2);

    qm.checkExpiredQuests(10, playerStub());

    const failed = qm.getExpiredQuests();
    expect(failed.length).toBe(2);
    expect(failed.every((q) => q.isFailed)).toBe(true);
  });

  it("expiry notification message from checkExpiredQuests contains title and 'просрочен'", () => {
    const qm = new QuestManager();
    const quest = new Quest(
      "q_notif",
      "Эскорт конвоя",
      QuestType.ESCORT,
      [],
      EMPTY_REWARD,
      [],
      "planet_B",
      0,
      5,
      null,
    );
    qm["activeQuests"].set(quest.id, quest);

    const expired = qm.checkExpiredQuests(10, playerStub());
    const notifications = expired.map((q) => `Квест просрочен: «${q.title}»`);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("просрочен");
    expect(notifications[0]).toContain("Эскорт конвоя");
  });
});
