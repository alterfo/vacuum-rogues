import { describe, it, expect } from "vitest";
import { PanZoomController, DRAG_THRESHOLD } from "@/systems/PanZoomController";

describe("routePersist: planet-click route not swallowed by onPointerUp", () => {
  it("shouldSwallowClick returns false when startDragTracking was never called (planet-click path)", () => {
    const ctrl = new PanZoomController();
    ctrl.onMove(400, 300); // cursor is far from stale origin (0,0)
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
    ctrl.onMove(500, 500); // very far from stale origin — should NOT swallow
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("second click in space (after planet click) re-activates tracking correctly", () => {
    const ctrl = new PanZoomController();

    ctrl.onMove(600, 400); // stale distance, should be ignored
    expect(ctrl.shouldSwallowClick()).toBe(false);
    ctrl.reset(); // pointerup

    ctrl.startDragTracking(600, 400);
    ctrl.onMove(600 + DRAG_THRESHOLD + 1, 400); // drag beyond threshold
    expect(ctrl.shouldSwallowClick()).toBe(true);
  });
});
