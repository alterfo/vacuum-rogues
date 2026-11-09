import { describe, it, expect, vi } from "vitest";
import { WinScene } from "@/presentation/WinScene";
import { Text } from "pixi.js";

vi.mock("pixi.js", () => {
  const makeNode = () => ({
    children: [] as unknown[],
    eventMode: "auto",
    cursor: "default",
    alpha: 1,
    x: 0,
    y: 0,
    text: "",
    style: {},
    anchor: { set: vi.fn() },
    on: vi.fn(),
    addChild: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(() => {
      const node = makeNode();
      node.addChild = vi.fn((child: unknown) => {
        (node.children as unknown[]).push(child);
        return child;
      });
      return node;
    }),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeNode(),
      rect: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => ({
      ...makeNode(),
      text: opts?.text != null ? String(opts.text) : "",
    })),
  };
});

function makeRenderer() {
  const layer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
  });
  return {
    app: { screen: { width: 1024, height: 768 }, stage: { eventMode: "auto" } },
    stage: layer(),
    uiLayer: layer(),
    gameLayer: layer(),
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;
}

function makeEngine() {
  return {
    player: {
      rank: 3,
      credits: 9999,
      completedQuestChains: ["chain_1"],
      reputation: { BASTIONS: 4, SYNDICATE: -2 },
    },
    galaxy: { gameDays: 120 },
    questManager: { getCompletedQuestIds: () => ["q1", "q2"] },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

describe("WinScene completed-quests section (Task 4)", () => {
  it("shows the completed quest and chain counts", () => {
    const scene = new WinScene(makeRenderer());
    scene.initialize({ gameEngine: makeEngine() });

    const texts = vi
      .mocked(Text)
      .mock.results.map((r) => String((r.value as { text: string }).text));
    expect(texts).toContain("Завершено заданий: 2");
    expect(texts).toContain("Завершено цепочек: 1");

    scene.destroy();
  });
});
