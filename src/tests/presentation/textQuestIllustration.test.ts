/**
 * Text-quest illustration WIRING guard (three-year-campaign plan, Task 18).
 *
 * `quest_art/` ships no art yet (generation happens on the GPU box,
 * Post-Completion), so nothing else exercises the "lights up when art lands"
 * path. Mirrors `stationArtWiring.test.ts`: mock `pickVariantKey`/`tex`/
 * `loadTextureAsync` so both the no-art fallback and the art-present mount
 * are pinned without any real asset on disk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuestScript } from "@/systems/quests/QuestScript";

const tx = vi.hoisted(() => ({
  pickVariantKey: vi.fn<[string, string, string], string | undefined>(),
  tex: vi.fn<[string], unknown>(),
  loadTextureAsync: vi.fn<[string], Promise<unknown>>(),
}));

vi.mock("@/presentation/textures", () => ({
  pickVariantKey: tx.pickVariantKey,
  tex: tx.tex,
  loadTextureAsync: tx.loadTextureAsync,
}));

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    getChildIndex: vi.fn().mockReturnValue(0),
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
  Sprite: vi.fn().mockImplementation((t: unknown) => ({
    texture: t,
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
    mask: null,
    eventMode: "auto",
    destroyed: false,
    destroy: vi.fn(),
  })),
}));

import { TextQuestScene } from "@/presentation/TextQuestScene";

function makeRenderer() {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as any;
}

const script: QuestScript = {
  id: "auction",
  title: "Аукцион",
  params: [],
  startLocation: "start",
  locations: [
    { id: "start", text: "Начало.", transitions: [], isSuccess: true },
  ],
};

function makeEngine() {
  return {
    player: { currentSystemId: "sys1", faction: "OUTLANDERS" },
    galaxy: { systems: [] },
  } as any;
}

describe("TextQuestScene — quest illustration (quest_art/<scriptId>)", () => {
  beforeEach(() => {
    tx.pickVariantKey.mockReset();
    tx.tex.mockReset();
    tx.loadTextureAsync.mockReset();
  });

  it("queries the quest_art category with the script's literal id as prefix and seed", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: script,
      seed: 1,
    });

    expect(tx.pickVariantKey).toHaveBeenCalledWith(
      "quest_art",
      "auction",
      "auction",
    );
  });

  it("no-art fallback: renders without mounting a Sprite when no key resolves", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    const scene = new TextQuestScene(makeRenderer());
    expect(() =>
      scene.initialize({
        gameEngine: makeEngine(),
        questScript: script,
        seed: 1,
      }),
    ).not.toThrow();
    expect(tx.tex).not.toHaveBeenCalled();
    expect(tx.loadTextureAsync).not.toHaveBeenCalled();
  });

  it("lights up when art lands: mounts a Sprite from the cached texture", async () => {
    tx.pickVariantKey.mockReturnValue("quest_art/auction");
    tx.tex.mockReturnValue({ width: 1024, height: 640 });
    const renderer = makeRenderer();
    const scene = new TextQuestScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: script,
      seed: 1,
    });

    const { Sprite } = await import("pixi.js");
    expect(Sprite).toHaveBeenCalledWith({ width: 1024, height: 640 });
  });

  it("lazy-loads via loadTextureAsync when the key exists but isn't cached yet", async () => {
    tx.pickVariantKey.mockReturnValue("quest_art/auction");
    tx.tex.mockReturnValue(undefined);
    const loadedTexture = { width: 1024, height: 640 };
    tx.loadTextureAsync.mockResolvedValue(loadedTexture);
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: script,
      seed: 1,
    });

    expect(tx.loadTextureAsync).toHaveBeenCalledWith("quest_art/auction");
    await Promise.resolve();
    await Promise.resolve();

    const { Sprite } = await import("pixi.js");
    expect(Sprite).toHaveBeenCalledWith(loadedTexture);
  });
});
