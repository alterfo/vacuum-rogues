import { describe, it, expect, vi, afterEach } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
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
});

const blankRoutingScript: QuestScript = {
  id: "reveal_blank_routing",
  title: "Пустой узел",
  params: [],
  startLocation: "intro",
  locations: [
    {
      id: "intro",
      text: "",
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

function startAuto(script: QuestScript) {
  const scene = new TextQuestScene(makeRenderer());
  scene.initialize({ gameEngine: makeEngine(), questScript: script });
  const loc = () => ((scene as any).vm as QuestVM).currentLocation().id;
  return { scene, loc };
}

describe("TextQuestScene auto-execute nodes wait for the player", () => {
  it("never advances a node with text on its own, however long it waits", () => {
    vi.useFakeTimers();
    const { scene, loc } = startAuto(autoChainScript);

    scene.update(50);
    scene.update(5000);
    expect(narrationText(scene)).toBe(LONG_TEXT);

    vi.advanceTimersByTime(60_000);
    expect(loc()).toBe("intro");

    scene.destroy();
  });

  it("advances on the continue action and reveals the next node", () => {
    vi.useFakeTimers();
    const { scene, loc } = startAuto(autoChainScript);

    scene.update(5000);
    (scene as any).continueFromAuto();
    expect(loc()).toBe("mid");
    expect((scene as any).revealing).toBe(true);

    scene.destroy();
  });

  it("Space completes a live reveal first, then continues on the next press", () => {
    vi.useFakeTimers();
    const { scene, loc } = startAuto(autoChainScript);

    scene.update(50);
    (scene as any).onVmKeyDown({ key: " " } as KeyboardEvent);
    expect(narrationText(scene)).toBe(LONG_TEXT);
    expect(loc()).toBe("intro");

    (scene as any).onVmKeyDown({ key: "Enter" } as KeyboardEvent);
    expect(loc()).toBe("mid");

    scene.destroy();
  });

  it("still passes through blank routing nodes without stopping", () => {
    vi.useFakeTimers();
    const { scene, loc } = startAuto(blankRoutingScript);

    vi.advanceTimersByTime(800);
    expect(loc()).toBe("end");

    scene.destroy();
  });
});
