/**
 * Task 3 (settings interface): the unified in-flight settings panel
 * (СКОРОСТЬ / ШРИФТ / НЕЙРОСЕТЬ). These drive the `SettingsPanel` component
 * directly with mocked pixi.js so no WebGL/texture context is needed. They pin
 * that the panel:
 *   • reads the current settings (neural defaults OFF),
 *   • writes each change through the shared `gameSettings` store and fans the
 *     live effect out (`applySpeed` / `applyFont` / `onNeuralToggle`),
 *   • requests a close after a font pick (the historical ⚙-panel contract),
 *   • is Esc-closable through the flight key router.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay?: number) {
        anchor.x = ax;
        anchor.y = ay ?? ax;
      },
    };
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      alpha: 1,
      x: 0,
      y: 0,
      anchor,
      text: "",
      width: 50,
      style: {},
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
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      rect: vi.fn().mockReturnThis(),
      roundRect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi
      .fn()
      .mockImplementation(
        (opts?: { text?: unknown; style?: { fontSize?: number } }) => {
          const node = makeContainer();
          node.text = opts?.text != null ? String(opts.text) : "";
          node.style = opts?.style ?? {};
          return node;
        },
      ),
  };
});

import { Graphics, Text } from "pixi.js";
import {
  SettingsPanel,
  type SettingsPanelDeps,
} from "@/presentation/ui/SettingsPanel";
import {
  NEURAL_ENABLED_KEY,
  type SettingsStore,
  type SpeedTarget,
} from "@/systems/settings/gameSettings";
import { handleFlightKey } from "@/presentation/flight/flightKeyHandler";

function makeStore(): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function makeDeps(overrides: Partial<SettingsPanelDeps> = {}): {
  deps: SettingsPanelDeps;
  speedTarget: SpeedTarget;
  store: ReturnType<typeof makeStore>;
  applySpeed: ReturnType<typeof vi.fn>;
  applyFont: ReturnType<typeof vi.fn>;
  applyLanguage: ReturnType<typeof vi.fn>;
  onNeuralToggle: ReturnType<typeof vi.fn>;
  onRequestClose: ReturnType<typeof vi.fn>;
} {
  const speedTarget: SpeedTarget = { gameSpeedMultiplier: 1 };
  const store = makeStore();
  const applySpeed = vi.fn();
  const applyFont = vi.fn();
  const applyLanguage = vi.fn();
  const onNeuralToggle = vi.fn();
  const onRequestClose = vi.fn();
  const deps: SettingsPanelDeps = {
    speedTarget,
    speedSteps: [1, 2, 4],
    applySpeed,
    applyFont,
    applyLanguage,
    onNeuralToggle,
    onRequestClose,
    store,
    ...overrides,
  };
  return {
    deps,
    speedTarget,
    store,
    applySpeed,
    applyFont,
    applyLanguage,
    onNeuralToggle,
    onRequestClose,
  };
}

/** All pixi Graphics pointerdown handlers, in creation order. */
function graphicsPointerdownHandlers(): Array<
  (e: { stopPropagation: () => void }) => void
> {
  return vi
    .mocked(Graphics)
    .mock.results.map((r) => r.value as { on?: ReturnType<typeof vi.fn> })
    .flatMap((g) =>
      (g.on?.mock.calls ?? [])
        .filter((c: unknown[]) => c[0] === "pointerdown")
        .map(
          (c: unknown[]) =>
            c[1] as (e: { stopPropagation: () => void }) => void,
        ),
    );
}

/** Texts created so far, by their string content. */
function allTexts(): string[] {
  return vi
    .mocked(Text)
    .mock.results.map((r) => String((r.value as { text: string }).text));
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("reads current settings and defaults the neural toggle to OFF (ВЫКЛ)", () => {
    const { deps } = makeDeps();
    const panel = new SettingsPanel(deps);
    expect(panel.isNeuralOn()).toBe(false);
    const texts = allTexts();
    expect(texts).toContain("ВЫКЛ");
    expect(texts).not.toContain("ВКЛ");
    // Surfaces all three controls.
    expect(texts).toContain("СКОРОСТЬ");
    expect(texts).toContain("ШРИФТ");
    expect(texts).toContain("НЕЙРОСЕТЬ (ИИ)");
  });

  it("selectSpeed writes through the store and applies live", () => {
    const { deps, speedTarget, applySpeed } = makeDeps();
    const panel = new SettingsPanel(deps);
    panel.selectSpeed(4);
    expect(speedTarget.gameSpeedMultiplier).toBe(4);
    expect(applySpeed).toHaveBeenLastCalledWith(4);
  });

  it("an out-of-range speed falls back to the default through the store", () => {
    const { deps, speedTarget } = makeDeps();
    const panel = new SettingsPanel(deps);
    panel.selectSpeed(99); // not a selectable step
    // setSpeed clamps unknown values to the default (1×).
    expect(speedTarget.gameSpeedMultiplier).toBe(1);
  });

  it("selectFont persists the size, restyles live, then requests a close", () => {
    const { deps, applyFont, onRequestClose } = makeDeps();
    const panel = new SettingsPanel(deps);
    panel.selectFont("L");
    expect(localStorage.getItem("fontScale")).toBe("L");
    expect(applyFont).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("toggleNeural flips the flag through the store and notifies the gate", () => {
    const { deps, store, onNeuralToggle } = makeDeps();
    const panel = new SettingsPanel(deps);

    panel.toggleNeural();
    expect(store.data.get(NEURAL_ENABLED_KEY)).toBe("true");
    expect(panel.isNeuralOn()).toBe(true);
    expect(onNeuralToggle).toHaveBeenLastCalledWith(true);
    // After flipping on, the re-rendered toggle reads ВКЛ.
    expect(allTexts()).toContain("ВКЛ");

    panel.toggleNeural();
    expect(store.data.get(NEURAL_ENABLED_KEY)).toBe("false");
    expect(panel.isNeuralOn()).toBe(false);
    expect(onNeuralToggle).toHaveBeenLastCalledWith(false);
  });

  it("the first hit area is the font control (⚙-panel contract / playtest4 A)", () => {
    const { deps, applyFont, onRequestClose } = makeDeps();
    new SettingsPanel(deps);
    const handlers = graphicsPointerdownHandlers();
    expect(handlers.length).toBeGreaterThanOrEqual(7); // 3 font + 3 speed + 1 neural
    handlers[0]({ stopPropagation: vi.fn() });
    // Tapping the first cell drives the font path (smallest, "S").
    expect(localStorage.getItem("fontScale")).toBe("S");
    expect(applyFont).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("the neural hit area flips the flag when fired", () => {
    const { deps, store } = makeDeps();
    new SettingsPanel(deps);
    const handlers = graphicsPointerdownHandlers();
    // Last of the cell hit areas is the neural toggle (built last on purpose).
    handlers[handlers.length - 1]({ stopPropagation: vi.fn() });
    expect(store.data.get(NEURAL_ENABLED_KEY)).toBe("true");
  });

  it("surfaces a ЯЗЫК row with both language autonyms, active = RU by default", () => {
    const { deps } = makeDeps();
    const panel = new SettingsPanel(deps);
    expect(panel.currentLanguage()).toBe("ru");
    const texts = allTexts();
    expect(texts).toContain("ЯЗЫК"); // settings.language (RU, the default)
    // Both options are always shown in their own script (autonyms).
    expect(texts).toContain("Русский");
    expect(texts).toContain("English");
  });

  it("selectLanguage persists the choice, re-localizes live, then requests a close", () => {
    const { deps, applyLanguage, onRequestClose } = makeDeps();
    const panel = new SettingsPanel(deps);
    panel.selectLanguage("en");
    expect(localStorage.getItem("language")).toBe("en");
    expect(panel.currentLanguage()).toBe("en");
    expect(applyLanguage).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("reflects the persisted language — the section label localizes to EN", () => {
    localStorage.setItem("language", "en");
    const { deps } = makeDeps();
    const panel = new SettingsPanel(deps);
    expect(panel.currentLanguage()).toBe("en");
    // The whole panel now renders in English (settings.language EN value).
    expect(allTexts()).toContain("LANGUAGE");
  });

  it("the language hit areas (after the speed cells) switch the language", () => {
    const { deps } = makeDeps();
    new SettingsPanel(deps);
    const handlers = graphicsPointerdownHandlers();
    // 3 font + 3 speed + 2 language + 1 neural = 9 cells.
    expect(handlers.length).toBe(9);
    // The 8th cell (index 7) is the second language button (EN).
    handlers[7]({ stopPropagation: vi.fn() });
    expect(localStorage.getItem("language")).toBe("en");
  });
});

describe("SettingsPanel Esc-close wiring (flightKeyHandler)", () => {
  it("Escape closes the open settings panel via closeModals", () => {
    const closeModals = vi.fn();
    const ctx = {
      combatPause: { paused: false, resume: vi.fn() },
      npcManager: {
        isContactPanelOpen: false,
        closeContactPanel: vi.fn(),
      },
      hud: {
        isQuestJournalOpen: () => false,
        closeQuestJournal: vi.fn(),
        toggleQuestJournal: vi.fn(),
        isSettingsPanelOpen: () => true,
        closeModals,
        showMessage: vi.fn(),
      },
      planetManager: { hasInfoPanel: false, closeInfoPanel: vi.fn() },
      plannedRoute: null,
      isTurnRunning: false,
      clearPlannedRoute: vi.fn(),
      executeRouteTo: vi.fn(),
      openInventory: vi.fn(),
    };
    handleFlightKey(
      { key: "Escape" } as unknown as KeyboardEvent,
      ctx as unknown as Parameters<typeof handleFlightKey>[1],
    );
    expect(closeModals).toHaveBeenCalledTimes(1);
  });
});
