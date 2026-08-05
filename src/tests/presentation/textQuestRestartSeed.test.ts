import { describe, it, expect, vi } from "vitest";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { QuestVM } from "@/systems/quests/QuestVM";

vi.mock("@/presentation/textures", () => ({
  pickVariantKey: vi.fn().mockReturnValue(undefined),
  tex: vi.fn(),
  loadTextureAsync: vi.fn(),
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
    hitArea: null,
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

import {
  TextQuestScene,
  deriveRestartSeed,
} from "@/presentation/TextQuestScene";

const script: QuestScript = {
  id: "restart_probe",
  title: "Проверка перезапуска",
  params: [
    {
      id: "roll",
      name: "Бросок",
      min: 0,
      max: 1_000_000,
      initial: "random",
      showInUI: false,
    },
  ],
  startLocation: "start",
  locations: [{ id: "start", text: "Начало.", transitions: [] }],
};

function makeRenderer() {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as any;
}

function makeEngine() {
  return {
    player: { currentSystemId: "sys1", faction: "OUTLANDERS" },
    galaxy: { systems: [] },
  } as any;
}

describe("deriveRestartSeed", () => {
  it("returns the base seed unchanged on attempt 0 (first run unaffected)", () => {
    expect(deriveRestartSeed(42, 0)).toBe("42");
    expect(deriveRestartSeed("abc", 0)).toBe("abc");
  });

  it("mixes in the attempt counter for retries", () => {
    expect(deriveRestartSeed(42, 1)).toBe("42:1");
    expect(deriveRestartSeed(42, 2)).toBe("42:2");
  });

  it("is deterministic for a given (base seed, attempt)", () => {
    expect(deriveRestartSeed(7, 3)).toBe(deriveRestartSeed(7, 3));
  });

  it("produces distinct seeds for distinct attempts on the same base", () => {
    const seeds = [1, 2, 3, 4, 5].map((a) => deriveRestartSeed(9, a));
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("QuestVM rolls under restart seeds", () => {
  it("varies across attempts but stays deterministic per (seed, attempt)", () => {
    const rollFor = (attempt: number) =>
      new QuestVM(script, deriveRestartSeed(1234, attempt)).getParam("roll");

    expect(rollFor(1)).toBe(rollFor(1));

    const rolls = [1, 2, 3, 4, 5].map(rollFor);
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });
});

describe("TextQuestScene restart path", () => {
  it("re-rolls a fresh VM on each restart instead of replaying the same seed", () => {
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: script,
      seed: 55,
    });

    const rolls: number[] = [];
    for (let i = 0; i < 5; i++) {
      (scene as any).restartVm();
      rolls.push(((scene as any).vm as QuestVM).getParam("roll"));
    }

    expect((scene as any).restartAttempt).toBe(5);
    expect(new Set(rolls).size).toBeGreaterThan(1);

    scene.destroy();
  });

  it("keeps the initial run on the base seed (attempt 0)", () => {
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: script,
      seed: 55,
    });

    const baseRoll = ((scene as any).vm as QuestVM).getParam("roll");
    const expected = new QuestVM(script, deriveRestartSeed(55, 0)).getParam(
      "roll",
    );
    expect(baseRoll).toBe(expected);

    scene.destroy();
  });
});
