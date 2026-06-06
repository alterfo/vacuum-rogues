import { describe, it, expect, vi } from "vitest";
import type { TextQuest, QuestNode, QuestOutcome } from "@/types";

// ── PixiJS mock (must come before imports that load pixi.js) ─────────────────

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    destroyed: false,
    destroy: vi.fn(),
    on: vi.fn(),
    eventMode: "auto",
    cursor: "auto",
    alpha: 1,
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    eventMode: "auto",
    on: vi.fn(),
    destroyed: false,
    destroy: vi.fn(),
  })),
  Text: vi.fn().mockImplementation((opts?: { text?: string }) => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    text: opts?.text ?? "",
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    label: "",
    destroyed: false,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
}));

// ── Also mock onnxruntime-web (loaded transitively via QuestNarrator) ─────────

vi.mock("onnxruntime-web", () => ({
  Tensor: vi.fn(),
  InferenceSession: { create: vi.fn() },
}));

// ── Imports under test ────────────────────────────────────────────────────────

import { TextQuestScene } from "@/presentation/TextQuestScene";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRenderer() {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as any;
}

function makeQuest(): TextQuest {
  return {
    id: "test_quest",
    title: "Тестовый квест",
    startNodeId: "node_a",
    nodes: [
      {
        id: "node_a",
        textKey: "test.intro",
        choices: [
          {
            label: "Выбор 1",
            conditions: [],
            nextNodeId: "node_b",
            outcome: null,
          },
          {
            label: "Выбор 2 (платный)",
            conditions: [{ type: "credits", comparison: ">=", value: 500 }],
            nextNodeId: "node_b",
            outcome: null,
          },
        ],
      },
      {
        id: "node_b",
        textKey: "test.middle",
        choices: [
          {
            label: "Завершить",
            conditions: [],
            nextNodeId: null,
            outcome: {
              creditsDelta: 200,
              reputationDelta: 10,
              factionId: "OUTLANDERS",
              journalEntry: "Квест пройден",
            },
          },
        ],
      },
    ],
  };
}

function makePlayer(credits = 1000) {
  return {
    credits,
    getReputation: vi.fn().mockReturnValue(0),
    adjustReputation: vi.fn((_factionId: string, _delta: number) => {}),
    inventory: { resources: [] as { type: string; amount: number }[] },
    journal: { entries: [] as { id: string; date: number; text: string }[] },
    currentSystemId: "sys_1",
    faction: "OUTLANDERS",
  };
}

function makeGameEngine(player: ReturnType<typeof makePlayer>) {
  return {
    player,
    textQuestRuntime: new TextQuestRuntime(),
    questNarrator: {
      narrate: vi.fn().mockResolvedValue("Нарратив для узла"),
    },
    galaxy: {
      gameDays: 5,
      systems: [{ id: "sys_1", name: "Алтаир" }],
    },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TextQuestScene.initialize", () => {
  it("initializes without throwing given a valid quest and player", () => {
    const renderer = makeRenderer();
    const player = makePlayer();
    const engine = makeGameEngine(player);
    const scene = new TextQuestScene(renderer);
    expect(() =>
      scene.initialize({ gameEngine: engine, quest: makeQuest() }),
    ).not.toThrow();
  });

  it("transitions back immediately when no quest provided", () => {
    const renderer = makeRenderer();
    const player = makePlayer();
    const engine = makeGameEngine(player);
    const scene = new TextQuestScene(renderer);
    scene.initialize({ gameEngine: engine, returnScene: "PLANET" as any });
    expect(engine.transitionTo).toHaveBeenCalled();
  });

  it("transitions back immediately when no player in engine", () => {
    const renderer = makeRenderer();
    const engine = { ...makeGameEngine(makePlayer()), player: null };
    const scene = new TextQuestScene(renderer);
    scene.initialize({ gameEngine: engine as any, quest: makeQuest() });
    expect(engine.transitionTo).toHaveBeenCalled();
  });
});

describe("TextQuestScene: full quest path traversal via runtime", () => {
  it("starts at first node and advances to next on free choice", () => {
    const runtime = new TextQuestRuntime();
    const quest = makeQuest();
    const player = makePlayer(1000);

    const firstNode = runtime.start(quest, player as any);
    expect(firstNode.id).toBe("node_a");

    const nextNode = runtime.choose("node_a", 0, player as any);
    expect(nextNode).not.toBeNull();
    expect((nextNode as QuestNode).id).toBe("node_b");
  });

  it("terminal choice returns null and outcome is applied", () => {
    const runtime = new TextQuestRuntime();
    const quest = makeQuest();
    const player = makePlayer(500);

    runtime.start(quest, player as any);
    runtime.choose("node_a", 0, player as any);

    const terminal = runtime.choose("node_b", 0, player as any);
    expect(terminal).toBeNull();

    const terminalNode = quest.nodes.find((n) => n.id === "node_b")!;
    const outcome = terminalNode.choices[0].outcome as QuestOutcome;
    runtime.applyOutcome(outcome, player as any);

    expect(player.credits).toBe(700); // 500 + 200
    expect(player.journal.entries).toHaveLength(1);
    expect(player.journal.entries[0].text).toBe("Квест пройден");
  });

  it("blocks gated choice when credits are insufficient", () => {
    const runtime = new TextQuestRuntime();
    const quest = makeQuest();
    const player = makePlayer(0); // 0 credits, but choice requires 500

    runtime.start(quest, player as any);
    expect(() => runtime.choose("node_a", 1, player as any)).toThrow(
      GameBusinessException,
    );
  });

  it("allows gated choice when credits meet the requirement", () => {
    const runtime = new TextQuestRuntime();
    const quest = makeQuest();
    const player = makePlayer(600); // 600 >= 500 requirement

    runtime.start(quest, player as any);
    const next = runtime.choose("node_a", 1, player as any);
    expect(next).not.toBeNull();
    expect((next as QuestNode).id).toBe("node_b");
  });
});

describe("TextQuestScene.destroy", () => {
  it("cleans up without throwing", () => {
    const renderer = makeRenderer();
    const player = makePlayer();
    const engine = makeGameEngine(player);
    const scene = new TextQuestScene(renderer);
    scene.initialize({ gameEngine: engine, quest: makeQuest() });
    expect(() => scene.destroy()).not.toThrow();
  });
});
