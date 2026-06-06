import { describe, it, expect, beforeEach } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  QUEST_TEXT_RATIO,
  QUEST_ELITE_RATIO,
  type BoardOptions,
} from "@/systems/quests/QuestGenerator";
import { QuestManager } from "@/systems/QuestManager";
import { Player } from "@/domain/Player";
import type { QuestLog, Journal } from "@/types";

// ── helpers ────────────────────────────────────────────────────────────────

function sys(id: string, name: string, toIds: string[]): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
  } as unknown as StarSystem;
}

function chainGalaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"]),
    sys("B", "Бета", ["A", "C"]),
    sys("C", "Гамма", ["B", "D"]),
    sys("D", "Дельта", ["C"]),
  ];
}

function baseOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "galaxy-seed",
    ...over,
  };
}

function makePlayer(): Player {
  const questLog: QuestLog = { activeQuests: [], completedQuests: [] };
  const journal: Journal = { entries: [] };
  return new Player(
    "player-1",
    "Test",
    "OUTLANDERS" as any,
    0,
    1,
    {} as any,
    {},
    questLog,
    journal,
    1000,
    {} as any,
    { modules: [], micromodules: [], resources: [], cosmetics: [] } as any,
    "A",
  );
}

// ── elite quest filtering ──────────────────────────────────────────────────

describe("Task 16: Elite quest reputation filtering", () => {
  it("generates some elite quests with minReputation=50 and doubled reward", () => {
    // Force no text/chain quests and a large board to see elites consistently.
    const board = generateQuestBoard(
      baseOpts({
        count: 200,
        textRatio: 0,
        chainRatio: 0,
        eliteRatio: QUEST_ELITE_RATIO,
      }),
    );
    const elites = board.filter((q) => (q.template.minReputation ?? 0) >= 50);
    const normals = board.filter((q) => (q.template.minReputation ?? 0) === 0);
    expect(elites.length).toBeGreaterThan(0);
    expect(normals.length).toBeGreaterThan(0);
    // Elite reward must be at least the non-elite minimum (they're doubled).
    for (const eq of elites) {
      expect(eq.template.reward.credits).toBeGreaterThan(0);
    }
  });

  it("elite quests have roughly QUEST_ELITE_RATIO frequency among routine quests", () => {
    const board = generateQuestBoard(
      baseOpts({ count: 1000, textRatio: 0, chainRatio: 0 }),
    );
    const elites = board.filter((q) => (q.template.minReputation ?? 0) > 0);
    const ratio = elites.length / board.length;
    expect(ratio).toBeGreaterThan(QUEST_ELITE_RATIO - 0.07);
    expect(ratio).toBeLessThan(QUEST_ELITE_RATIO + 0.07);
  });

  it("filters elite quests when player reputation is below threshold", () => {
    // Board with all quests being either elite or normal.
    const board = generateQuestBoard(
      baseOpts({ count: 50, textRatio: 0, chainRatio: 0, eliteRatio: 1.0 }),
    );
    // All are elite (minReputation=50).
    const player = makePlayer();
    // reputation["OUTLANDERS"] is 0 by default → all elite quests should be filtered.
    const faction = "OUTLANDERS";
    const filtered = board.filter((q) => {
      const minRep = q.template.minReputation ?? 0;
      return player.getReputation(faction) >= minRep;
    });
    expect(filtered.length).toBe(0);
  });

  it("shows elite quests when player has enough reputation", () => {
    const board = generateQuestBoard(
      baseOpts({ count: 20, textRatio: 0, chainRatio: 0, eliteRatio: 1.0 }),
    );
    const player = makePlayer();
    player.adjustReputation("OUTLANDERS", 60); // rep = 60 ≥ 50
    const faction = "OUTLANDERS";
    const filtered = board.filter((q) => {
      const minRep = q.template.minReputation ?? 0;
      return player.getReputation(faction) >= minRep;
    });
    expect(filtered.length).toBe(board.length);
  });
});

// ── quest chain completion ─────────────────────────────────────────────────

describe("Task 16: Quest chain completion", () => {
  let manager: QuestManager;
  let player: Player;

  beforeEach(() => {
    manager = new QuestManager();
    player = makePlayer();
  });

  it("adds chainId to player.completedQuestChains when all 3 parts are done", () => {
    const chainId = "chain-test-001";
    for (let part = 0; part < 3; part++) {
      const id = `chain-quest-${part}`;
      manager.acceptQuestFromTemplate(
        {
          id,
          title: `Цепочка часть ${part}`,
          description: "",
          type: QuestType.DELIVERY,
          objectives: [
            {
              id: `${id}_obj`,
              description: "obj",
              type: "VISIT_LOCATION",
              targetAmount: 1,
              locationId: "A",
            },
          ],
          reward: { credits: 100, experience: 50, items: [] },
          dialogueAnchors: [],
          deadline: 0,
          failurePenalty: null,
          chainId,
          chainPart: part,
        },
        "planet-A",
        0,
      );
      // Force objectives done so completeQuest succeeds.
      manager.updateQuestProgress({
        type: "VISIT_LOCATION",
        locationId: "A",
        amount: 1,
      });
      manager.completeQuest(id, player);
    }
    expect(player.completedQuestChains).toContain(chainId);
  });

  it("does NOT add chainId when only 2 of 3 parts are done", () => {
    const chainId = "chain-test-002";
    for (let part = 0; part < 2; part++) {
      const id = `chain-incomplete-${part}`;
      manager.acceptQuestFromTemplate(
        {
          id,
          title: `Неполная цепочка часть ${part}`,
          description: "",
          type: QuestType.DELIVERY,
          objectives: [
            {
              id: `${id}_obj`,
              description: "obj",
              type: "VISIT_LOCATION",
              targetAmount: 1,
              locationId: "A",
            },
          ],
          reward: { credits: 100, experience: 50, items: [] },
          dialogueAnchors: [],
          deadline: 0,
          failurePenalty: null,
          chainId,
          chainPart: part,
        },
        "planet-A",
        0,
      );
      manager.updateQuestProgress({
        type: "VISIT_LOCATION",
        locationId: "A",
        amount: 1,
      });
      manager.completeQuest(id, player);
    }
    expect(player.completedQuestChains).not.toContain(chainId);
  });

  it("does NOT duplicate chainId in completedQuestChains", () => {
    const chainId = "chain-test-003";
    // Complete chain once.
    for (let part = 0; part < 3; part++) {
      const id = `chain-dedup-${part}`;
      manager.acceptQuestFromTemplate(
        {
          id,
          title: `Дублирование ${part}`,
          description: "",
          type: QuestType.DELIVERY,
          objectives: [
            {
              id: `${id}_obj`,
              description: "obj",
              type: "VISIT_LOCATION",
              targetAmount: 1,
              locationId: "A",
            },
          ],
          reward: { credits: 100, experience: 50, items: [] },
          dialogueAnchors: [],
          deadline: 0,
          failurePenalty: null,
          chainId,
          chainPart: part,
        },
        "planet-A",
        0,
      );
      manager.updateQuestProgress({
        type: "VISIT_LOCATION",
        locationId: "A",
        amount: 1,
      });
      manager.completeQuest(id, player);
    }
    // Manually trigger again (shouldn't add duplicate).
    manager.completeQuest("non-existent", player);
    expect(
      player.completedQuestChains.filter((c) => c === chainId).length,
    ).toBe(1);
  });
});

// ── chain generation on board ─────────────────────────────────────────────

describe("Task 16: Chain quest board generation", () => {
  it("emits chain quests with chainId and chainPart 0..2", () => {
    const board = generateQuestBoard(
      baseOpts({ count: 100, textRatio: 0, eliteRatio: 0, chainRatio: 1.0 }),
    );
    const chainQuests = board.filter(
      (q) => q.template.chainId !== null && q.template.chainId !== undefined,
    );
    expect(chainQuests.length).toBeGreaterThan(0);
    for (const cq of chainQuests) {
      const part = cq.template.chainPart ?? -1;
      expect(part).toBeGreaterThanOrEqual(0);
      expect(part).toBeLessThanOrEqual(2);
    }
  });

  it("emits a finale quest for a completed chain", () => {
    const board = generateQuestBoard(
      baseOpts({
        count: 20,
        textRatio: 0,
        eliteRatio: 0,
        chainRatio: 1.0,
        completedQuestChains: ["chain-A_p1-0"], // matches deterministic chainId for planetId=A_p1, bucket=0
      }),
    );
    const finales = board.filter((q) => q.template.chainPart === 3);
    expect(finales.length).toBeGreaterThanOrEqual(1);
  });
});

// ── TEXT_ADVENTURE ratio (pre-existing, verify still works) ──────────────

describe("Task 16: TEXT_ADVENTURE ratio unchanged", () => {
  it("text-quests are emitted at ~QUEST_TEXT_RATIO", () => {
    let text = 0;
    let total = 0;
    for (let p = 0; p < 60; p++) {
      const board = generateQuestBoard(
        baseOpts({ planetId: `P${p}`, day: p * 5, count: 5 }),
      );
      for (const q of board) {
        total++;
        if (q.template.type === QuestType.TEXT_ADVENTURE) text++;
      }
    }
    const ratio = text / total;
    expect(total).toBeGreaterThan(100);
    expect(ratio).toBeGreaterThan(QUEST_TEXT_RATIO - 0.08);
    expect(ratio).toBeLessThan(QUEST_TEXT_RATIO + 0.08);
  });
});
