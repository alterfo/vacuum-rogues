import { describe, it, expect } from "vitest";
import { PanZoomController, DRAG_THRESHOLD } from "@/systems/PanZoomController";

describe("PanZoomController", () => {
  it("starts in idle state (not panning, dragDistance=0)", () => {
    const ctrl = new PanZoomController();
    expect(ctrl.isPanning).toBe(false);
    expect(ctrl.dragDistance).toBe(0);
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("startPan activates panning (RMB, works regardless of isTurnRunning)", () => {
    const ctrl = new PanZoomController();
    ctrl.startPan(100, 200);
    expect(ctrl.isPanning).toBe(true);
  });

  it("pan returns correct delta on each move", () => {
    const ctrl = new PanZoomController();
    ctrl.startPan(100, 100);
    const delta1 = ctrl.onMove(130, 110);
    expect(delta1).toEqual({ dx: 30, dy: 10 });
    const delta2 = ctrl.onMove(120, 100);
    expect(delta2).toEqual({ dx: -10, dy: -10 });
  });

  it("reset stops panning and clears drag distance", () => {
    const ctrl = new PanZoomController();
    ctrl.startPan(0, 0);
    ctrl.onMove(50, 50);
    ctrl.reset();
    expect(ctrl.isPanning).toBe(false);
    expect(ctrl.dragDistance).toBe(0);
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("onMove returns null (no pan delta) when not panning", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    const result = ctrl.onMove(10, 0);
    expect(result).toBeNull();
  });

  it("drag below threshold does NOT swallow click → route may be set", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(DRAG_THRESHOLD - 1, 0); // just under the threshold
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("drag above threshold swallows click → no route set", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(DRAG_THRESHOLD + 1, 0); // just over the threshold
    expect(ctrl.shouldSwallowClick()).toBe(true);
  });

  it("drag exactly at threshold does NOT swallow (boundary: > not >=)", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(DRAG_THRESHOLD, 0);
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("new startDragTracking resets accumulated drag distance", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(100, 100); // large drag
    expect(ctrl.shouldSwallowClick()).toBe(true);

    ctrl.reset();
    ctrl.startDragTracking(200, 200); // new press at different position
    ctrl.onMove(201, 200); // tiny move
    expect(ctrl.shouldSwallowClick()).toBe(false);
  });

  it("pan during isTurnRunning: panning sets isPanning, so scene skips route logic", () => {
    const ctrl = new PanZoomController();
    ctrl.startPan(0, 0);
    ctrl.onMove(50, 30); // pan some amount

    expect(ctrl.isPanning).toBe(true);
    expect(ctrl.onMove(60, 40)).not.toBeNull(); // still returning pan delta
  });

  it("drag distance tracks diagonal movement correctly", () => {
    const ctrl = new PanZoomController();
    ctrl.startDragTracking(0, 0);
    ctrl.onMove(6, 8); // hypotenuse = 10
    expect(ctrl.dragDistance).toBeCloseTo(10);
    expect(ctrl.shouldSwallowClick()).toBe(true);
  });
});
