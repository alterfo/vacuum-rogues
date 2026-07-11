/**
 * Task 1 (docs/plans/20260711-autopilot-reliability-fixes.md, Issue 1): a
 * routine mouse-wheel zoom gesture on the star map used to bubble all the way
 * to `window`, where the dev autopilot's reclaim-on-input listener treats any
 * `wheel` event as "a human took back control" and disengages — even though
 * `handleWheel()` already fully handled the gesture. `handleWheel()` now calls
 * `stopPropagation()` so the event never reaches a `window`-level listener.
 *
 * `canvas` is a genuine DOM descendant of `window` here (unlike
 * `SpaceFlightScene.onWheel`, which is itself registered directly on
 * `window` — see `spaceFlightWheelZoomAutopilotReclaim.test.ts` for that
 * same-node case), so a plain `stopPropagation()` on the canvas listener is
 * sufficient and order-independent: the event simply never bubbles up to
 * `window` regardless of when a `window`-level listener was registered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Renderer } from "@/presentation/Renderer";

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    children: unknown[] = [];
    on() {
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy() {}
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    clear() {
      return this;
    }
  }
  class Text extends FakeBase {
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }
  class Sprite extends FakeBase {}
  class BlurFilter {}
  return { Container, Graphics, Text, Sprite, BlurFilter };
});

const { StarMapScene } = await import("@/presentation/StarMapScene");

function makeRenderer(canvas: HTMLCanvasElement): Renderer {
  const uiLayer = { addChild: vi.fn(), removeChild: vi.fn(), children: [] };
  return {
    app: { screen: { width: 800, height: 600 }, canvas },
    uiLayer,
  } as unknown as Renderer;
}

describe("StarMapScene wheel-zoom does not disengage the autopilot", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stops propagation so a real wheel gesture never reaches a window-level listener", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const scene = new StarMapScene(makeRenderer(canvas));
    (
      scene as unknown as { setupViewportControls(): void }
    ).setupViewportControls();

    const windowReclaim = vi.fn();
    window.addEventListener("wheel", windowReclaim);
    try {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(windowReclaim).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("wheel", windowReclaim);
    }
  });

  it("zoom level still changes from a real wheel gesture (fix does not break zooming)", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const scene = new StarMapScene(makeRenderer(canvas));
    (
      scene as unknown as { setupViewportControls(): void }
    ).setupViewportControls();
    const fields = scene as unknown as Record<string, unknown>;

    expect(fields.zoomLevel).toBe(1);
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(fields.zoomLevel).toBeCloseTo(1.1);
  });
});
