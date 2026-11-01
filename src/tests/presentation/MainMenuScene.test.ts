import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeNode = () => {
    const anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay?: number) {
        anchor.x = ax;
        anchor.y = ay ?? ax;
      },
    };
    const scale = { x: 1, y: 1, set: vi.fn() };
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      alpha: 1,
      x: 0,
      y: 0,
      width: 50,
      height: 16,
      rotation: 0,
      anchor,
      scale,
      text: "",
      style: {},
      parent: null,
      on: vi.fn(),
      destroy: vi.fn(),
    };
    node.addChild = vi.fn((c: unknown) => {
      (node.children as unknown[]).push(c);
      return c;
    });
    node.removeChild = vi.fn();
    return node;
  };
  const Graphics = vi.fn().mockImplementation(() => ({
    ...makeNode(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
  }));
  return {
    Container: vi.fn().mockImplementation(makeNode),
    Graphics,
    Sprite: vi.fn().mockImplementation(() => makeNode()),
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
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  tex: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
}));

import { Text } from "pixi.js";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { SettingsPanel } from "@/presentation/ui/SettingsPanel";
import { t, getLanguage, setLanguage } from "@/i18n/i18n";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

function makeLayer() {
  const layer: {
    children: unknown[];
    addChild: ReturnType<typeof vi.fn>;
    removeChild: ReturnType<typeof vi.fn>;
  } = {
    children: [],
    addChild: vi.fn((c: unknown) => {
      layer.children.push(c);
      return c;
    }),
    removeChild: vi.fn(),
  };
  return layer;
}

function makeMockRenderer(width = 1024, height = 768): Renderer {
  return {
    app: {
      screen: { width, height },
      stage: { eventMode: "auto" },
      canvas: undefined,
    },
    stage: makeLayer(),
    uiLayer: makeLayer(),
    gameLayer: makeLayer(),
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function makeEngine(): GameEngine {
  return {
    gameSpeedMultiplier: 1,
    saveManager: { hasSave: vi.fn().mockResolvedValue(false) },
    galaxy: null,
  } as unknown as GameEngine;
}

function clickTextButton(label: string): boolean {
  const inst = vi
    .mocked(Text)
    .mock.results.map(
      (r) => r.value as { text: string; on: { mock: { calls: unknown[][] } } },
    )
    .find((n) => n.text === label);
  if (!inst) return false;
  const down = inst.on.mock.calls.find((c) => c[0] === "pointerdown");
  if (!down) return false;
  (down[1] as () => void)();
  return true;
}

describe("MainMenuScene settings (Task 8 — relocated from the in-flight HUD)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("builds a localized «Настройки» button", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });

    const labels = vi
      .mocked(Text)
      .mock.results.map((r) => String((r.value as { text: string }).text));
    expect(labels).toContain(t("menu.settings"));
  });

  it("opens the shared SettingsPanel when «Настройки» is clicked", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });

    expect(
      (scene as unknown as { settingsPanel: SettingsPanel | null })
        .settingsPanel,
    ).toBeNull();

    expect(clickTextButton(t("menu.settings"))).toBe(true);

    expect(
      (scene as unknown as { settingsPanel: SettingsPanel | null })
        .settingsPanel,
    ).toBeInstanceOf(SettingsPanel);
  });

  it("a speed control writes through gameSettings onto the engine store", () => {
    const engine = makeEngine();
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: engine });
    clickTextButton(t("menu.settings"));

    const panel = (scene as unknown as { settingsPanel: SettingsPanel | null })
      .settingsPanel!;
    panel.selectSpeed(2);

    expect(engine.gameSpeedMultiplier).toBe(2);
  });

  it("a language control persists through the i18n localStorage pref", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));

    const panel = (scene as unknown as { settingsPanel: SettingsPanel | null })
      .settingsPanel;
    expect(panel).toBeInstanceOf(SettingsPanel);
    panel!.selectLanguage("en");

    expect(getLanguage()).toBe("en");
    setLanguage("ru");
  });

  it("closes the panel on its own close request", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));

    clickTextButton(t("menu.settings"));

    expect(
      (scene as unknown as { settingsPanel: SettingsPanel | null })
        .settingsPanel,
    ).toBeNull();
  });
});

describe("MainMenuScene credits entry (Task 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a «Титры» entry and opens a dismissible credits overlay", () => {
    const renderer = makeMockRenderer();
    const scene = new MainMenuScene(renderer);
    scene.initialize({ gameEngine: makeEngine() });

    const labels = vi
      .mocked(Text)
      .mock.results.map((r) => String((r.value as { text: string }).text));
    expect(labels).toContain(t("menu.credits"));

    expect(clickTextButton(t("menu.credits"))).toBe(true);
    expect(
      (renderer.stage as unknown as { children: unknown[] }).children.length,
    ).toBeGreaterThan(0);

    expect(clickTextButton(t("menu.creditsClose"))).toBe(true);
    expect(
      (scene as unknown as { creditsOverlay: unknown }).creditsOverlay,
    ).toBeNull();
    scene.destroy();
  });
});
