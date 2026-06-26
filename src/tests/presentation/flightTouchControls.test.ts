/**
 * FlightTouchController (mobile adaptation Phase 2, Task 3) — the seam between
 * PixiJS touch pointer events and the pure gesture interpreter. These tests prove
 * the wiring without a renderer:
 *
 *   - a two-finger pinch drives `camera.zoomByFactor` (spread = zoom-in factor
 *     > 1, pinch = factor < 1) about the finger midpoint;
 *   - the *second* finger flips it into "pinch mode" (onDown ⇒ true) so the scene
 *     suppresses the route the first finger planned;
 *   - **mouse** events and a **non-touch layout** are ignored (every method
 *     early-returns) so the desktop path is untouched;
 *   - single-finger moves are passed through (onMove ⇒ false) — taps stay on the
 *     scene's existing route path.
 */
import { describe, it, expect, vi } from "vitest";
import {
  FlightTouchController,
  type TouchPointerEvent,
} from "@/presentation/flight/flightTouchControls";

function touch(id: number, x: number, y: number): TouchPointerEvent {
  return { pointerId: id, pointerType: "touch", global: { x, y } };
}
function mouse(id: number, x: number, y: number): TouchPointerEvent {
  return { pointerId: id, pointerType: "mouse", global: { x, y } };
}

function build(gate = true) {
  const camera = { zoomByFactor: vi.fn() };
  const ctrl = new FlightTouchController(camera, () => gate);
  return { camera, ctrl };
}

describe("FlightTouchController — touch gating", () => {
  it("ignores mouse pointers entirely (desktop path untouched)", () => {
    const { camera, ctrl } = build();
    expect(ctrl.onDown(mouse(1, 10, 10))).toBe(false);
    expect(ctrl.onDown(mouse(2, 50, 10))).toBe(false); // would be a "pinch" if it were touch
    expect(ctrl.onMove(mouse(2, 90, 10))).toBe(false);
    ctrl.onUp(mouse(2, 90, 10));
    expect(camera.zoomByFactor).not.toHaveBeenCalled();
    expect(ctrl.isPinching).toBe(false);
  });

  it("ignores all touches when the layout gate is off (narrow desktop window)", () => {
    const { camera, ctrl } = build(false);
    expect(ctrl.onDown(touch(1, 100, 100))).toBe(false);
    expect(ctrl.onDown(touch(2, 200, 100))).toBe(false);
    expect(ctrl.onMove(touch(2, 300, 100))).toBe(false);
    expect(camera.zoomByFactor).not.toHaveBeenCalled();
  });
});

describe("FlightTouchController — one finger (tap path)", () => {
  it("a single finger never enters pinch mode and never zooms", () => {
    const { camera, ctrl } = build();
    expect(ctrl.onDown(touch(1, 100, 100))).toBe(false);
    expect(ctrl.isPinching).toBe(false);
    expect(ctrl.onMove(touch(1, 140, 130))).toBe(false); // pass-through (existing route path owns it)
    ctrl.onUp(touch(1, 140, 130));
    expect(camera.zoomByFactor).not.toHaveBeenCalled();
  });
});

describe("FlightTouchController — two-finger pinch", () => {
  it("the second finger enters pinch mode (onDown ⇒ true)", () => {
    const { ctrl } = build();
    expect(ctrl.onDown(touch(1, 100, 100))).toBe(false);
    expect(ctrl.onDown(touch(2, 200, 100))).toBe(true);
    expect(ctrl.isPinching).toBe(true);
  });

  it("spreading the fingers zooms in (factor > 1) about the midpoint", () => {
    const { camera, ctrl } = build();
    ctrl.onDown(touch(1, 100, 100));
    ctrl.onDown(touch(2, 200, 100)); // baseline distance = 100
    const consumed = ctrl.onMove(touch(2, 300, 100)); // distance → 200
    expect(consumed).toBe(true);
    expect(camera.zoomByFactor).toHaveBeenCalledTimes(1);
    const [scale, cx, cy] = camera.zoomByFactor.mock.calls[0];
    expect(scale).toBeCloseTo(2, 5); // 200 / 100
    expect(cx).toBeCloseTo(200, 5); // midpoint of (100,100)+(300,100)
    expect(cy).toBeCloseTo(100, 5);
  });

  it("pinching the fingers together zooms out (factor < 1)", () => {
    const { camera, ctrl } = build();
    ctrl.onDown(touch(1, 100, 100));
    ctrl.onDown(touch(2, 200, 100)); // baseline distance = 100
    ctrl.onMove(touch(2, 150, 100)); // distance → 50
    const [scale] = camera.zoomByFactor.mock.calls[0];
    expect(scale).toBeCloseTo(0.5, 5); // 50 / 100
  });

  it("composes multiplicatively frame-to-frame (incremental ratio)", () => {
    const { camera, ctrl } = build();
    ctrl.onDown(touch(1, 100, 100));
    ctrl.onDown(touch(2, 200, 100)); // 100
    ctrl.onMove(touch(2, 300, 100)); // 200 → ×2
    ctrl.onMove(touch(2, 400, 100)); // 300 → ×1.5
    expect(camera.zoomByFactor.mock.calls.map((c) => c[0])).toEqual([
      expect.closeTo(2, 5),
      expect.closeTo(1.5, 5),
    ]);
  });

  it("clears finger state after both lift — a later single tap is not a pinch", () => {
    const { ctrl } = build();
    ctrl.onDown(touch(1, 100, 100));
    ctrl.onDown(touch(2, 200, 100));
    ctrl.onUp(touch(1, 100, 100));
    ctrl.onUp(touch(2, 200, 100));
    expect(ctrl.isPinching).toBe(false);
    expect(ctrl.onDown(touch(3, 50, 50))).toBe(false); // fresh single finger
  });

  it("reset() drops in-progress pinch state", () => {
    const { ctrl } = build();
    ctrl.onDown(touch(1, 100, 100));
    ctrl.onDown(touch(2, 200, 100));
    expect(ctrl.isPinching).toBe(true);
    ctrl.reset();
    expect(ctrl.isPinching).toBe(false);
  });
});
