/**
 * Verifies that a route set by a planet click is NOT cleared by a subsequent
 * onPointerUp when the stage's onPointerDown was suppressed by stopPropagation.
 *
 * Root cause: stopPropagation on the planet sprite prevented startDragTracking
 * from being called. Any mouse movement after the planet click computed
 * _dragDistance relative to a stale _dragStartX/Y (from a previous gesture),
 * making shouldSwallowClick() return true and wiping the freshly-set route.
 *
 * Fix: PanZoomController.shouldSwallowClick() now requires _dragTrackingActive
 * (set by startDragTracking) in addition to _dragDistance > threshold.
 */
import { describe, it, expect } from "vitest";
import { PanZoomController, DRAG_THRESHOLD } from "@/systems/PanZoomController";

describe("routePersist: planet-click route not swallowed by onPointerUp", () => {
  it("shouldSwallowClick returns false when startDragTracking was never called (planet-click path)", () => {
    const ctrl = new PanZoomController();
    // Simulate mouse movement WITHOUT a prior startDragTracking call.
    // This mirrors the planet-click path: planet.pointerdown called stopPropagation,
    // so the stage's onPointerDown (which calls startDragTracking) never ran.
    ctrl.onMove(400, 300); // cursor is far from stale origin (0,0)
    // _dragDistance would be ~500 if tracking is active — but it's not active,
    // so shouldSwallowClick must return false.
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("shouldSwallowClick returns false when startDragTracking was called but drag is tiny", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(400, 300);
    ctrl.onMove(401, 300); // 1px — well below threshold
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("shouldSwallowClick returns true only when both tracking is active AND drag exceeds threshold", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(DRAG_THRESHOLD + 1, 0);
    expect(ctrl.shouldSwallowClick()).toBe(true);
  });

  it("reset clears _dragTrackingActive so subsequent move without new press is safe", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(100, 100); // big drag
    ctrl.reset(); // simulates pointerup
    // Now simulate a planet click: no startDragTracking, but mouse moves
    ctrl.onMove(500, 500); // very far from stale origin — should NOT swallow
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("second click in space (after planet click) re-activates tracking correctly", () => {
    const ctrl = new PanZoomController();

    // Planet click: no startDragTracking
    ctrl.onMove(600, 400); // stale distance, should be ignored
    expect(ctrl.shouldSwallowClick()).toBe(false);
    ctrl.reset(); // pointerup

    // Next click in space: startDragTracking IS called
    ctrl.startDragTracking(600, 400);
    ctrl.onMove(600 + DRAG_THRESHOLD + 1, 400); // drag beyond threshold
    expect(ctrl.shouldSwallowClick()).toBe(true);
  });
});
