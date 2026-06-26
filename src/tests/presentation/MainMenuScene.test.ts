/**
 * Task 8 (`docs/plans/20260626-playtest-bugs-pause-help-infocenter-i18n.md`):
 * the settings controls (speed / font / language / neural) moved off the
 * in-flight ⚙ HUD button onto the **main menu**. These exercise the real
 * `MainMenuScene` + the real shared `SettingsPanel` with mocked pixi.js + textures
 * (no WebGL/asset context), asserting:
 *   • the menu builds a localized «Настройки» button;
 *   • clicking it opens the shared `SettingsPanel`;
 *   • a control writes through `gameSettings` (speed → engine store, language →
 *     the i18n `localStorage` pref) so the choice persists into a run;
 *   • the panel closes on its own request.
 */
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

// Textures are not available headless — return the "art not loaded" fallbacks so
// the menu draws its disc/diamond placeholders and the nebula backdrop no-ops.
vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  tex: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
}));

import { Text } from "pixi.js";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { SettingsPanel } from "@/presentation/ui/SettingsPanel";
import { AccessibilityPanel } from "@/presentation/ui/AccessibilityPanel";
import { currentPaletteMode, factionColor } from "@/presentation/ui/palette";
import { Faction } from "@/types/faction";
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

/** Invoke the pointerdown handler of the created Text button with the given label. */
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

    // setSpeed(target, 2) persists onto the engine's gameSpeedMultiplier, so the
    // choice survives into flight (no live HUD/physics to update from the menu).
    expect(engine.gameSpeedMultiplier).toBe(2);
  });

  it("a language control persists through the i18n localStorage pref", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));

    const panel = (scene as unknown as { settingsPanel: SettingsPanel | null })
      .settingsPanel;
    // A font/language pick re-renders the menu and then closes the panel; capture
    // the ref before that close fires.
    expect(panel).toBeInstanceOf(SettingsPanel);
    panel!.selectLanguage("en");

    expect(getLanguage()).toBe("en");
    // restore default so later suites see RU
    setLanguage("ru");
  });

  it("closes the panel on its own close request", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));

    // Clicking «Настройки» again toggles the panel shut.
    clickTextButton(t("menu.settings"));

    expect(
      (scene as unknown as { settingsPanel: SettingsPanel | null })
        .settingsPanel,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Playtest bug pass 2, Task 4: the accessibility controls (colourblind palette /
// reduced-motion / key remap) now live in the general Settings overlay too — the
// menu mounts an `AccessibilityPanel` beside the `SettingsPanel`. Before this,
// the palette was only reachable from the in-flight ♿ button, so a player on the
// menu could not set it: "the palette change does nothing". The palette persists
// through the existing accessor and the faction hues render under it everywhere
// `factionColor` is read (faction-select / flight).
// ---------------------------------------------------------------------------

describe("MainMenuScene accessibility in Settings (Task 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  type WithA11y = {
    settingsPanel: SettingsPanel | null;
    accessibilityPanel: AccessibilityPanel | null;
  };

  it("mounts an AccessibilityPanel alongside the SettingsPanel", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });

    expect((scene as unknown as WithA11y).accessibilityPanel).toBeNull();

    clickTextButton(t("menu.settings"));

    const s = scene as unknown as WithA11y;
    expect(s.settingsPanel).toBeInstanceOf(SettingsPanel);
    expect(s.accessibilityPanel).toBeInstanceOf(AccessibilityPanel);
  });

  it("cycling the palette persists the mode and flows to factionColor", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));

    const accPanel = (scene as unknown as WithA11y).accessibilityPanel!;
    expect(accPanel.currentPalette()).toBe("default");
    const before = factionColor(Faction.SYNDICATE);

    accPanel.cyclePalette(); // default → deuteranopia

    expect(accPanel.currentPalette()).toBe("deuteranopia");
    expect(currentPaletteMode()).toBe("deuteranopia");
    // The colour seam now renders under the new palette — the "palette applies" fix.
    expect(factionColor(Faction.SYNDICATE)).not.toBe(before);
  });

  it("closing the overlay tears down both the settings and accessibility panels", () => {
    const scene = new MainMenuScene(makeMockRenderer());
    scene.initialize({ gameEngine: makeEngine() });
    clickTextButton(t("menu.settings"));
    // Toggle shut.
    clickTextButton(t("menu.settings"));

    const s = scene as unknown as WithA11y;
    expect(s.settingsPanel).toBeNull();
    expect(s.accessibilityPanel).toBeNull();
  });
});
