/**
 * Accessibility pass Task 4: the Accessibility settings group surfaced by the ♿
 * HUD button — palette mode / reduced-motion / key remap. These drive the
 * `AccessibilityPanel` component directly with mocked pixi.js (no WebGL/texture
 * context). They pin that the panel:
 *   • reads the current settings (palette default, reduced-motion OFF, default
 *     key bindings),
 *   • writes each change through the pure seams (`setPaletteMode` /
 *     `setReducedMotion` / `rebind`+`setKeymap`) and fans the live effect out,
 *   • captures a rebind, rejects a conflicting key, and aborts on Escape,
 *   • is closable through its «Закрыть» cell.
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
      destroyed: false,
      style: {},
      on: vi.fn(),
      destroy: vi.fn(function (this: { destroyed: boolean }) {
        this.destroyed = true;
      }),
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
  AccessibilityPanel,
  type AccessibilityPanelDeps,
} from "@/presentation/ui/AccessibilityPanel";
import {
  PALETTE_MODE_KEY,
  currentPaletteMode,
} from "@/presentation/ui/palette";
import { REDUCED_MOTION_KEY } from "@/presentation/ui/reducedMotion";
import { currentKeymap } from "@/presentation/input/keymap";

type KeyEvt = { key: string; code?: string };

/** A capture installer that records handlers + a disposer spy (no real DOM). */
function makeCapture(): {
  install: ReturnType<typeof vi.fn<[(e: KeyEvt) => void], () => void>>;
  dispose: ReturnType<typeof vi.fn>;
  fire: (e: KeyEvt) => void;
} {
  const dispose = vi.fn();
  let handler: ((e: KeyEvt) => void) | null = null;
  const install = vi.fn<[(e: KeyEvt) => void], () => void>(
    (h: (e: KeyEvt) => void): (() => void) => {
      handler = h;
      return dispose;
    },
  );
  return {
    install,
    dispose,
    fire: (e) => handler?.(e),
  };
}

function makeDeps(
  overrides: Partial<AccessibilityPanelDeps> = {},
): AccessibilityPanelDeps {
  return {
    onPaletteChange: vi.fn(),
    onReducedMotionChange: vi.fn(),
    onKeymapChange: vi.fn(),
    onRequestClose: vi.fn(),
    ...overrides,
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

describe("AccessibilityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders the three accessibility groups with their defaults", () => {
    new AccessibilityPanel(makeDeps());
    const texts = allTexts();
    expect(texts).toContain("ДОСТУПНОСТЬ");
    expect(texts).toContain("ПАЛИТРА");
    expect(texts).toContain("МЕНЬШЕ ДВИЖЕНИЯ");
    expect(texts).toContain("УПРАВЛЕНИЕ");
    // Palette defaults to "Обычная"; reduced-motion defaults OFF (ВЫКЛ).
    expect(texts).toContain("Обычная");
    expect(texts).toContain("ВЫКЛ");
    // Default key bindings are shown.
    expect(texts).toContain("Esc");
    expect(texts).toContain("Пробел");
    expect(texts).toContain("J");
    expect(texts).toContain("I");
  });

  it("cyclePalette steps through the modes, persisting + fanning out each", () => {
    const onPaletteChange = vi.fn();
    const panel = new AccessibilityPanel(makeDeps({ onPaletteChange }));
    expect(panel.currentPalette()).toBe("default");

    panel.cyclePalette();
    expect(panel.currentPalette()).toBe("deuteranopia");
    expect(localStorage.getItem(PALETTE_MODE_KEY)).toBe("deuteranopia");
    expect(onPaletteChange).toHaveBeenLastCalledWith("deuteranopia");
    expect(allTexts()).toContain("Дейтеранопия");

    panel.cyclePalette(); // → protanopia
    panel.cyclePalette(); // → tritanopia
    panel.cyclePalette(); // wraps → default
    expect(panel.currentPalette()).toBe("default");
  });

  it("toggleReducedMotion flips the explicit setting and fans it out", () => {
    const onReducedMotionChange = vi.fn();
    const panel = new AccessibilityPanel(makeDeps({ onReducedMotionChange }));
    expect(panel.isReducedMotionOn()).toBe(false);

    panel.toggleReducedMotion();
    expect(panel.isReducedMotionOn()).toBe(true);
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("true");
    expect(onReducedMotionChange).toHaveBeenLastCalledWith(true);
    expect(allTexts()).toContain("ВКЛ");

    panel.toggleReducedMotion();
    expect(panel.isReducedMotionOn()).toBe(false);
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("false");
  });

  it("rebinds an action onto a free key: persists, fires onKeymapChange, disposes capture", () => {
    const capture = makeCapture();
    const onKeymapChange = vi.fn();
    const panel = new AccessibilityPanel(
      makeDeps({ installKeyCapture: capture.install, onKeymapChange }),
    );

    panel.beginRebind("journal");
    expect(capture.install).toHaveBeenCalledTimes(1);
    expect(panel.isRebinding("journal")).toBe(true);

    capture.fire({ key: "k" });
    expect(panel.isRebinding("journal")).toBe(false);
    expect(currentKeymap().journal).toBe("k");
    expect(onKeymapChange).toHaveBeenCalledTimes(1);
    expect(capture.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects rebinding onto a key another action already holds (conflict)", () => {
    const capture = makeCapture();
    const onKeymapChange = vi.fn();
    const panel = new AccessibilityPanel(
      makeDeps({ installKeyCapture: capture.install, onKeymapChange }),
    );

    panel.beginRebind("journal");
    capture.fire({ key: "i" }); // 'i' is the inventory binding
    // Rejected: binding unchanged, conflict surfaced, capture stays open.
    expect(currentKeymap().journal).toBe("j");
    expect(panel.isRebinding("journal")).toBe(true);
    expect(panel.rebindConflict()).toBe("inventory");
    expect(onKeymapChange).not.toHaveBeenCalled();
    expect(capture.dispose).not.toHaveBeenCalled();
    expect(allTexts()).toContain("клавиша занята");
  });

  it("Escape during a rebind aborts without changing the binding", () => {
    const capture = makeCapture();
    const panel = new AccessibilityPanel(
      makeDeps({ installKeyCapture: capture.install }),
    );
    panel.beginRebind("inventory");
    capture.fire({ key: "Escape" });
    expect(panel.isRebinding("inventory")).toBe(false);
    expect(currentKeymap().inventory).toBe("i"); // unchanged
    expect(capture.dispose).toHaveBeenCalledTimes(1);
  });

  it("resetKeymapToDefaults restores the historical bindings", () => {
    const capture = makeCapture();
    const panel = new AccessibilityPanel(
      makeDeps({ installKeyCapture: capture.install }),
    );
    panel.beginRebind("journal");
    capture.fire({ key: "k" });
    expect(currentKeymap().journal).toBe("k");

    panel.resetKeymapToDefaults();
    expect(currentKeymap().journal).toBe("j");
    expect(currentKeymap().inventory).toBe("i");
  });

  it("the first two hit areas cycle the palette and toggle reduced motion", () => {
    const panel = new AccessibilityPanel(makeDeps());
    const handlers = graphicsPointerdownHandlers();
    // palette, motion, 4 action rows, reset, close = 8 cells.
    expect(handlers.length).toBe(8);

    handlers[0]({ stopPropagation: vi.fn() }); // palette cycle
    expect(panel.currentPalette()).toBe("deuteranopia");

    handlers[1]({ stopPropagation: vi.fn() }); // reduced-motion toggle
    expect(panel.isReducedMotionOn()).toBe(true);
  });

  it("the last hit area (Закрыть) asks the host to close", () => {
    const onRequestClose = vi.fn();
    new AccessibilityPanel(makeDeps({ onRequestClose }));
    const handlers = graphicsPointerdownHandlers();
    handlers[handlers.length - 1]({ stopPropagation: vi.fn() });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("reflects a persisted palette mode + reduced-motion on construction", () => {
    localStorage.setItem(PALETTE_MODE_KEY, "tritanopia");
    localStorage.setItem(REDUCED_MOTION_KEY, "true");
    const panel = new AccessibilityPanel(makeDeps());
    expect(panel.currentPalette()).toBe("tritanopia");
    expect(panel.isReducedMotionOn()).toBe(true);
    expect(currentPaletteMode()).toBe("tritanopia");
    const texts = allTexts();
    expect(texts).toContain("Тританопия");
    expect(texts).toContain("ВКЛ");
  });

  it("destroy() disposes a pending rebind capture", () => {
    const capture = makeCapture();
    const panel = new AccessibilityPanel(
      makeDeps({ installKeyCapture: capture.install }),
    );
    panel.beginRebind("cancel");
    panel.destroy();
    expect(capture.dispose).toHaveBeenCalledTimes(1);
  });
});
