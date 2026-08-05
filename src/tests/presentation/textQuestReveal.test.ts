import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { TextQuestScene } from "@/presentation/TextQuestScene";

const LONG_TEXT =
  "Диспетчерская молчит. На экране мигает предупреждение о сближении, " +
  "и таймер уже пошёл — решать надо быстро, но не бездумно.";

const manualScript: QuestScript = {
  id: "reveal_manual",
  title: "Раскрытие текста",
  params: [],
  startLocation: "intro",
  locations: [
    {
      id: "intro",
      text: LONG_TEXT,
      transitions: [
        { id: "go", label: "Дальше", toLocation: "end", effects: [] },
      ],
    },
    { id: "end", text: "Готово.", transitions: [], isSuccess: true },
  ],
};

const autoChainScript: QuestScript = {
  id: "reveal_auto_chain",
  title: "Авто-цепочка",
  params: [],
  startLocation: "intro",
  locations: [
    {
      id: "intro",
      text: LONG_TEXT,
      transitions: [
        {
          id: "toMid",
          label: "...",
          toLocation: "mid",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "mid",
      text: LONG_TEXT,
      transitions: [
        {
          id: "toEnd",
          label: "...",
          toLocation: "end",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    { id: "end", text: "Финал.", transitions: [], isSuccess: true },
  ],
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
    questManager: { forceCompleteQuest: vi.fn() },
  } as any;
}

function narrationText(scene: TextQuestScene): string {
  return ((scene as any).vmNarrationText as { text: string }).text;
}

beforeEach(() => {
  localStorage.removeItem("reducedMotion");
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem("reducedMotion");
});

describe("TextQuestScene typewriter reveal", () => {
  it("types the narration out over update ticks instead of showing it instantly", () => {
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({ gameEngine: makeEngine(), questScript: manualScript });

    expect((scene as any).revealing).toBe(true);
    expect(narrationText(scene).length).toBeLessThan(LONG_TEXT.length);

    scene.update(200);
    const partial = narrationText(scene);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(LONG_TEXT.length);
    expect(LONG_TEXT.startsWith(partial)).toBe(true);

    scene.update(5000);
    expect(narrationText(scene)).toBe(LONG_TEXT);
    expect((scene as any).revealing).toBe(false);

    scene.destroy();
  });

  it("click-to-skip snaps the narration to full text immediately", () => {
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({ gameEngine: makeEngine(), questScript: manualScript });

    expect((scene as any).revealing).toBe(true);
    (scene as any).completeReveal();

    expect(narrationText(scene)).toBe(LONG_TEXT);
    expect((scene as any).revealing).toBe(false);

    scene.destroy();
  });

  it("shows full text with no delay under reduced motion", () => {
    localStorage.setItem("reducedMotion", "true");

    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({ gameEngine: makeEngine(), questScript: manualScript });

    expect(narrationText(scene)).toBe(LONG_TEXT);
    expect((scene as any).revealing).toBe(false);

    scene.destroy();
  });
});

describe("TextQuestScene auto-execute chain waits for the reveal", () => {
  it("does not advance a routing node while a live reveal is still typing", () => {
    vi.useFakeTimers();
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: autoChainScript,
    });
    const vm = () => ((scene as any).vm as QuestVM).currentLocation().id;

    scene.update(50);
    expect((scene as any).revealing).toBe(true);
    expect(narrationText(scene).length).toBeLessThan(LONG_TEXT.length);

    vi.advanceTimersByTime(800);
    expect(vm()).toBe("intro");

    scene.update(5000);
    expect(vm()).toBe("mid");
    expect((scene as any).revealing).toBe(true);

    scene.destroy();
  });

  it("skipping the reveal advances at the 800 ms beat, not before", () => {
    vi.useFakeTimers();
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: autoChainScript,
    });
    const vm = () => ((scene as any).vm as QuestVM).currentLocation().id;

    scene.update(50); // live loop
    (scene as any).completeReveal(); // click-to-skip → full text now shown
    expect(narrationText(scene)).toBe(LONG_TEXT);
    expect(vm()).toBe("intro");

    vi.advanceTimersByTime(800);
    expect(vm()).toBe("mid");

    scene.destroy();
  });

  it("advances at the 800 ms beat in a headless (no update loop) context", () => {
    vi.useFakeTimers();
    const scene = new TextQuestScene(makeRenderer());
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: autoChainScript,
    });
    const vm = () => ((scene as any).vm as QuestVM).currentLocation().id;

    expect((scene as any).revealing).toBe(true);
    expect(vm()).toBe("intro");

    vi.advanceTimersByTime(800);
    expect(vm()).toBe("mid");

    scene.destroy();
  });
});
