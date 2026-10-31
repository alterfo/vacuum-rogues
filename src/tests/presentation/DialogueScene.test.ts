import { describe, it, expect, vi } from "vitest";
import { DialogueScene } from "@/presentation/DialogueScene";
import { Text } from "pixi.js";
import * as textures from "@/presentation/textures";

vi.mock("pixi.js", () => {
  const makeNode = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "default",
      alpha: 1,
      x: 0,
      y: 0,
      width: 50,
      height: 16,
      text: "",
      style: {},
      mask: null,
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      on: vi.fn(),
      destroy: vi.fn(),
    };
    node.addChild = vi.fn((child: unknown) => {
      (node.children as unknown[]).push(child);
      return child;
    });
    node.removeChild = vi.fn();
    return node;
  };
  return {
    Container: vi.fn().mockImplementation(makeNode),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeNode(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeNode(),
      width: 80,
      height: 80,
    })),
    Text: vi
      .fn()
      .mockImplementation((opts?: { text?: unknown; style?: unknown }) => {
        const node = makeNode();
        node.text = opts?.text != null ? String(opts.text) : "";
        node.style = opts?.style ?? {};
        return node;
      }),
  };
});

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn(),
  pickVariantKey: vi.fn(),
  tex: vi.fn(),
  loadTextureAsync: vi.fn().mockResolvedValue(undefined),
}));

function makeRenderer() {
  const layer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
  });
  return {
    app: {
      screen: { width: 1024, height: 768 },
      stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
      canvas: undefined,
    },
    stage: layer(),
    uiLayer: layer(),
    gameLayer: layer(),
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;
}

function makeEngine() {
  return {
    questManager: {
      getActiveQuests: () => [],
      acceptQuest: vi.fn(),
      completeQuest: vi.fn(),
    },
    player: null,
    galaxy: null,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

describe("DialogueScene portrait and response polish (Task 4)", () => {
  it("requests portrait art instead of only drawing the blue circle", () => {
    vi.mocked(textures.pickVariant).mockReturnValue({
      width: 80,
      height: 80,
    } as never);

    const scene = new DialogueScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      npc: { id: "npc_trader", name: "Торговец", race: "OUTLANDERS" },
    });

    const portraitCalls = vi
      .mocked(textures.pickVariant)
      .mock.calls.filter((call) => call[0] === "portraits");
    expect(portraitCalls.length).toBeGreaterThan(0);
    expect(portraitCalls[0][1]).toBe("outlanders");

    scene.destroy();
  });

  it("wraps long response labels inside the button width", () => {
    vi.mocked(textures.pickVariant).mockReturnValue(undefined);

    const scene = new DialogueScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      npc: { id: "npc_trader", name: "Торговец" },
    });

    const response = vi
      .mocked(Text)
      .mock.results.map(
        (r) => r.value as { text: string; style: Record<string, unknown> },
      )
      .find((node) => node.text === "Завершить");
    expect(response).toBeTruthy();
    expect(response!.style.wordWrap).toBe(true);
    expect(response!.style.wordWrapWidth).toBeGreaterThan(0);

    scene.destroy();
  });
});
