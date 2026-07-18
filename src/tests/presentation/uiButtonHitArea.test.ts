import { describe, it, expect } from "vitest";
import { UiButton } from "@/presentation/ui/UiButton";
import { Rectangle } from "pixi.js";

/**
 * Real-pointer regression (2026-06-10 playtest): every UiButton child has
 * eventMode='none' (labels must not swallow clicks — CLAUDE.md Rule 3), which
 * in PixiJS 8 leaves the parent Container with NO hit-test geometry: the event
 * boundary prunes 'none' children and a bare Container contributes no bounds.
 * Without an explicit hitArea the button is mouse-dead even though direct
 * handler calls (e2e* methods) work — Ход/пауза, speed, gear and all
 * planet-menu buttons were unclickable with a real mouse.
 *
 * The E2E half of this regression lives in playtest-regression.spec.ts
 * ("HUD buttons respond to REAL mouse clicks").
 */
describe("UiButton hit geometry", () => {
  it("sets an explicit hitArea matching the button rect", () => {
    const btn = new UiButton("▶", "Ход", "primary", () => {}, 120, 40);
    const hit = btn.container.hitArea as Rectangle;

    expect(hit).toBeInstanceOf(Rectangle);
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(0);
    expect(hit.width).toBe(120);
    expect(hit.height).toBe(40);
  });

  it("keeps the container interactive and all children non-interactive", () => {
    const btn = new UiButton("", "Метка", "neutral", () => {});

    expect(btn.container.eventMode).toBe("static");
    expect(btn.container.cursor).toBe("pointer");
    for (const child of btn.container.children) {
      expect(child.eventMode).toBe("none");
    }
  });

  /**
   * Live report (2026-07-18): clicking the flight HUD's speed-x4 control
   * silently disengaged the dev-only live autopilot. Root cause: this class's
   * `pointerdown` handler only called `event.stopPropagation()` — which stops
   * Pixi's own internal scene-graph dispatch, NOT the underlying native DOM
   * PointerEvent, which still bubbled past the canvas all the way to `window`,
   * where `AutopilotController`'s reclaim-on-input listener picks up ANY
   * native pointerdown with no target filtering. Every UiButton in the game
   * (speed, gear, planet-menu, Ход/пауза...) shared this same gap. The fix
   * additionally calls `event.nativeEvent?.stopPropagation()` — this pins that
   * a click always attempts to stop the native event too, so a future
   * regression here can't silently reopen the same class of bug.
   */
  it("also stops the underlying native DOM event, not just Pixi's internal propagation", () => {
    const btn = new UiButton("", "Speed", "neutral", () => {});
    const nativeStop = () => {
      nativeStopCalled = true;
    };
    let nativeStopCalled = false;
    const event = {
      stopPropagation: () => {},
      nativeEvent: { stopPropagation: nativeStop },
    };

    btn.container.emit("pointerdown", event as never);

    expect(nativeStopCalled).toBe(true);
  });
});
