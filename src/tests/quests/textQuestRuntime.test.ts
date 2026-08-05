import { describe, it, expect } from "vitest";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import { SAMPLE_TEXT_QUESTS, getTextQuestById } from "@/domain/TextQuest";
import { Player } from "@/domain/Player";
import { Inventory } from "@/domain/Inventory";
import type { Journal, QuestLog, TextQuest } from "@/types";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

function makePlayer(credits = 1000): Player {
  const questLog: QuestLog = { activeQuests: [], completedQuests: [] };
  const journal: Journal = { entries: [] };
  const inventory = new Inventory();
  return new Player(
    "player-1",
    "Test Pilot",
    "OUTLANDERS" as any,
    0,
    1,
    {} as any,
    {},
    questLog,
    journal,
    credits,
    {} as any,
    inventory,
    "SYS_A",
  );
}

describe("SAMPLE_TEXT_QUESTS", () => {
  it("exports two sample quests with unique ids", () => {
    expect(SAMPLE_TEXT_QUESTS).toHaveLength(2);
    const ids = SAMPLE_TEXT_QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("getTextQuestById returns undefined for unknown id", () => {
    expect(getTextQuestById("nonexistent")).toBeUndefined();
  });

  it("getTextQuestById returns correct quest", () => {
    const q = getTextQuestById("text_quest_secret_cargo");
    expect(q).toBeDefined();
    expect(q!.title).toBe("Тайный груз");
  });

  it("each quest has a valid startNodeId", () => {
    for (const quest of SAMPLE_TEXT_QUESTS) {
      const startNode = quest.nodes.find((n) => n.id === quest.startNodeId);
      expect(startNode).toBeDefined();
    }
  });

  it("all nextNodeIds in choices point to existing nodes or null", () => {
    for (const quest of SAMPLE_TEXT_QUESTS) {
      const nodeIds = new Set(quest.nodes.map((n) => n.id));
      for (const node of quest.nodes) {
        for (const choice of node.choices) {
          if (choice.nextNodeId !== null) {
            expect(nodeIds.has(choice.nextNodeId)).toBe(true);
          }
        }
      }
    }
  });
});

describe("TextQuestRuntime.start", () => {
  it("returns the first node of the quest", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer();
    const node = runtime.start(quest, player);
    expect(node.id).toBe(quest.startNodeId);
  });

  it("throws when quest has no startNode", () => {
    const runtime = new TextQuestRuntime();
    const badQuest: TextQuest = {
      id: "bad",
      title: "Bad Quest",
      startNodeId: "nonexistent",
      nodes: [],
    };
    expect(() => runtime.start(badQuest, makePlayer())).toThrow(
      GameBusinessException,
    );
  });
});

describe("TextQuestRuntime.choose", () => {
  it("throws when no quest is active", () => {
    const runtime = new TextQuestRuntime();
    expect(() => runtime.choose("some_node", 0, makePlayer())).toThrow(
      GameBusinessException,
    );
  });

  it("traverses to next node on a free choice", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer();
    runtime.start(quest, player);
    const next = runtime.choose("sc_intro", 0, player);
    expect(next).not.toBeNull();
    expect(next!.id).toBe("sc_dilemma");
  });

  it("returns null on terminal node (no choices / nextNodeId=null)", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer();
    runtime.start(quest, player);
    runtime.choose("sc_intro", 1, player); // go to refuse branch
    const next = runtime.choose("sc_refuse", 0, player);
    expect(next).toBeNull();
  });

  it("throws when choice index is out of bounds", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer();
    runtime.start(quest, player);
    expect(() => runtime.choose("sc_intro", 99, player)).toThrow(
      GameBusinessException,
    );
  });

  it("blocks choice when credits condition not met", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer(0); // 0 credits, but choice requires 200
    runtime.start(quest, player);
    runtime.choose("sc_intro", 0, player); // intro → dilemma
    expect(() => runtime.choose("sc_inspect", 1, player)).toThrow(
      GameBusinessException,
    );
  });

  it("allows choice when credits condition is met", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer(500); // has 500 credits ≥ 200
    runtime.start(quest, player);
    runtime.choose("sc_intro", 0, player);
    const next = runtime.choose("sc_inspect", 1, player);
    expect(next).toBeNull(); // terminal node
  });
});

describe("TextQuestRuntime.applyOutcome", () => {
  it("adds credits to player", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer(100);
    runtime.applyOutcome(
      {
        creditsDelta: 300,
        reputationDelta: 0,
        journalEntry: "Test entry",
      },
      player,
    );
    expect(player.credits).toBe(400);
  });

  it("subtracts credits but floors at 0", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer(50);
    runtime.applyOutcome(
      {
        creditsDelta: -200,
        reputationDelta: 0,
        journalEntry: "Spent all",
      },
      player,
    );
    expect(player.credits).toBe(0);
  });

  it("adjusts faction reputation", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer();
    runtime.applyOutcome(
      {
        creditsDelta: 0,
        reputationDelta: 20,
        factionId: "BASTIONS",
        journalEntry: "Rep gained",
      },
      player,
    );
    expect(player.getReputation("BASTIONS")).toBe(20);
  });

  it("adds item to inventory", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer();
    runtime.applyOutcome(
      {
        creditsDelta: 0,
        reputationDelta: 0,
        itemGained: "ARTIFACTS",
        journalEntry: "Found artifact",
      },
      player,
    );
    const stack = player.inventory.resources.find(
      (r) => r.type === "ARTIFACTS",
    );
    expect(stack).toBeDefined();
    expect(stack!.amount).toBe(1);
  });

  it("removes item from inventory", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer();
    player.inventory.resources.push({ type: "FUEL" as any, amount: 3 });
    runtime.applyOutcome(
      {
        creditsDelta: 0,
        reputationDelta: 0,
        itemLost: "FUEL",
        journalEntry: "Used fuel",
      },
      player,
    );
    const stack = player.inventory.resources.find((r) => r.type === "FUEL");
    expect(stack!.amount).toBe(2);
  });

  it("appends journal entry", () => {
    const runtime = new TextQuestRuntime();
    const player = makePlayer();
    runtime.applyOutcome(
      {
        creditsDelta: 0,
        reputationDelta: 0,
        journalEntry: "Quest completed",
      },
      player,
    );
    expect(player.journal.entries.length).toBe(1);
    expect(player.journal.entries[0].text).toBe("Quest completed");
  });
});

describe("Full quest path traversal", () => {
  it("secret cargo: refuse path ends with no credits change", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_secret_cargo")!;
    const player = makePlayer(1000);
    runtime.start(quest, player);
    runtime.choose("sc_intro", 1, player); // refuse
    const terminal = runtime.choose("sc_refuse", 0, player);
    expect(terminal).toBeNull();
    const refuseNode = quest.nodes.find((n) => n.id === "sc_refuse")!;
    const outcome = refuseNode.choices[0].outcome!;
    runtime.applyOutcome(outcome, player);
    expect(player.credits).toBe(1000);
  });

  it("drifting ship: rescue path gives +300 credits and +20 rep", () => {
    const runtime = new TextQuestRuntime();
    const quest = getTextQuestById("text_quest_drifting_ship")!;
    const player = makePlayer(500);
    runtime.start(quest, player);
    const rescueNode = runtime.choose("ds_scan", 0, player);
    expect(rescueNode).not.toBeNull();
    expect(rescueNode!.id).toBe("ds_board");
    const rescueResult = runtime.choose("ds_board", 0, player);
    expect(rescueResult).not.toBeNull();
    expect(rescueResult!.id).toBe("ds_rescue");
    const terminal = runtime.choose("ds_rescue", 0, player);
    expect(terminal).toBeNull();
    const rescueFinalNode = quest.nodes.find((n) => n.id === "ds_rescue")!;
    const outcome = rescueFinalNode.choices[0].outcome!;
    runtime.applyOutcome(outcome, player);
    expect(player.credits).toBe(800); // 500 + 300
    expect(player.getReputation("OUTLANDERS")).toBe(20);
  });
});
