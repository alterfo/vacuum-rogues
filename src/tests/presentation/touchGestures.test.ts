import { describe, it, expect } from "vitest";
import {
  TouchGestureInterpreter,
  TAP_MOVE_TOLERANCE_PX,
  TAP_MAX_DURATION_MS,
  type GestureIntent,
  type PointerInput,
  type PanIntent,
  type PinchIntent,
  type TapIntent,
} from "@/presentation/flight/touchGestures";

/** Replay a recorded pointer sequence and collect every intent it produced. */
function replay(seq: PointerInput[]): GestureIntent[] {
  const gi = new TouchGestureInterpreter();
  return seq.flatMap((evt) => gi.handle(evt));
}

const pans = (out: GestureIntent[]) =>
  out.filter((i): i is PanIntent => i.type === "pan");
const pinches = (out: GestureIntent[]) =>
  out.filter((i): i is PinchIntent => i.type === "pinch");
const taps = (out: GestureIntent[]) =>
  out.filter((i): i is TapIntent => i.type === "tap");

describe("TouchGestureInterpreter — tap", () => {
  it("emits a tap for a quick stationary press-and-release", () => {
    const out = replay([
      { phase: "down", id: 1, x: 100, y: 200, t: 0 },
      { phase: "up", id: 1, x: 101, y: 201, t: 50 },
    ]);
    expect(taps(out)).toEqual([{ type: "tap", x: 101, y: 201 }]);
    expect(pans(out)).toHaveLength(0);
  });

  it("emits a tap even with no timestamps (duration check skipped)", () => {
    const out = replay([
      { phase: "down", id: 1, x: 50, y: 60 },
      { phase: "up", id: 1, x: 50, y: 60 },
    ]);
    expect(taps(out)).toHaveLength(1);
  });

  it("does NOT tap when the press drifts past the move tolerance", () => {
    const out = replay([
      { phase: "down", id: 1, x: 100, y: 100, t: 0 },
      {
        phase: "move",
        id: 1,
        x: 100 + TAP_MOVE_TOLERANCE_PX + 5,
        y: 100,
        t: 20,
      },
      { phase: "up", id: 1, x: 100 + TAP_MOVE_TOLERANCE_PX + 5, y: 100, t: 40 },
    ]);
    expect(taps(out)).toHaveLength(0);
    expect(pans(out).length).toBeGreaterThan(0);
  });

  it("does NOT tap when the press is held longer than the max duration", () => {
    const out = replay([
      { phase: "down", id: 1, x: 10, y: 10, t: 0 },
      { phase: "up", id: 1, x: 10, y: 10, t: TAP_MAX_DURATION_MS + 1 },
    ]);
    expect(taps(out)).toHaveLength(0);
  });

  it("still taps right at the duration boundary", () => {
    const out = replay([
      { phase: "down", id: 1, x: 10, y: 10, t: 0 },
      { phase: "up", id: 1, x: 10, y: 10, t: TAP_MAX_DURATION_MS },
    ]);
    expect(taps(out)).toHaveLength(1);
  });

  it("tolerates drift exactly at the tolerance (boundary is exclusive)", () => {
    const out = replay([
      { phase: "down", id: 1, x: 0, y: 0, t: 0 },
      { phase: "move", id: 1, x: TAP_MOVE_TOLERANCE_PX, y: 0, t: 10 },
      { phase: "up", id: 1, x: TAP_MOVE_TOLERANCE_PX, y: 0, t: 20 },
    ]);
    expect(taps(out)).toHaveLength(1);
    expect(pans(out)).toHaveLength(0);
  });
});

describe("TouchGestureInterpreter — pan (one-finger drag)", () => {
  it("emits incremental pan deltas while dragging", () => {
    const out = replay([
      { phase: "down", id: 1, x: 0, y: 0 },
      { phase: "move", id: 1, x: 20, y: 0 }, // crosses threshold → drag begins
      { phase: "move", id: 1, x: 35, y: 10 },
      { phase: "up", id: 1, x: 35, y: 10 },
    ]);
    const p = pans(out);
    // First pan is the move that crossed the threshold (delta from the down point).
    expect(p[0]).toEqual({ type: "pan", dx: 20, dy: 0 });
    expect(p[1]).toEqual({ type: "pan", dx: 15, dy: 10 });
    // Net pan equals total finger travel.
    const net = p.reduce((a, i) => ({ x: a.x + i.dx, y: a.y + i.dy }), {
      x: 0,
      y: 0,
    });
    expect(net).toEqual({ x: 35, y: 10 });
    expect(taps(out)).toHaveLength(0);
  });

  it("does not pan for sub-threshold jitter", () => {
    const out = replay([
      { phase: "down", id: 1, x: 0, y: 0 },
      { phase: "move", id: 1, x: 2, y: 1 },
      { phase: "move", id: 1, x: 3, y: 2 },
    ]);
    expect(pans(out)).toHaveLength(0);
  });
});

describe("TouchGestureInterpreter — pinch (two fingers)", () => {
  it("emits zoom-in (scale > 1) as fingers spread apart", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 100, y: 100 });
    gi.handle({ phase: "down", id: 2, x: 200, y: 100 }); // initial dist 100
    // spread finger 2 out to dist 200
    const out = gi.handle({ phase: "move", id: 2, x: 300, y: 100 });
    const pi = pinches(out);
    expect(pi).toHaveLength(1);
    expect(pi[0].scale).toBeCloseTo(2, 5);
    expect(pi[0].centerX).toBe(200); // midpoint of 100 and 300
    expect(pi[0].centerY).toBe(100);
  });

  it("emits zoom-out (scale < 1) as fingers come together", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 0, y: 0 });
    gi.handle({ phase: "down", id: 2, x: 200, y: 0 }); // dist 200
    const out = gi.handle({ phase: "move", id: 2, x: 100, y: 0 }); // dist 100
    const pi = pinches(out);
    expect(pi).toHaveLength(1);
    expect(pi[0].scale).toBeCloseTo(0.5, 5);
  });

  it("composes incremental scales multiplicatively across moves", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 0, y: 0 });
    gi.handle({ phase: "down", id: 2, x: 100, y: 0 }); // dist 100
    const a = pinches(gi.handle({ phase: "move", id: 2, x: 200, y: 0 })); // ×2 → 200
    const b = pinches(gi.handle({ phase: "move", id: 2, x: 400, y: 0 })); // ×2 → 400
    expect(a[0].scale).toBeCloseTo(2, 5);
    expect(b[0].scale).toBeCloseTo(2, 5);
    // Product = total zoom factor (100 → 400 = ×4).
    expect(a[0].scale * b[0].scale).toBeCloseTo(4, 5);
  });

  it("does NOT emit a scale-0 pinch when the two fingers coincide", () => {
    // Fingers crossing mid-pinch (dist → 0) must not yield scale 0, which
    // CameraController.zoomByFactor clamps to MIN_ZOOM — a jarring, sticky
    // snap-to-min. The interpreter re-baselines silently and resumes after.
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 0, y: 0 });
    gi.handle({ phase: "down", id: 2, x: 200, y: 0 }); // dist 200
    const collide = pinches(gi.handle({ phase: "move", id: 2, x: 0, y: 0 })); // dist 0
    expect(collide).toHaveLength(0); // no scale-0 emission
    // Spreading back out re-baselines (one frame) then resumes a normal, finite
    // pinch — no NaN/Infinity, no MIN_ZOOM snap.
    gi.handle({ phase: "move", id: 2, x: 100, y: 0 }); // dist 100 → re-baseline
    const apart = pinches(gi.handle({ phase: "move", id: 2, x: 300, y: 0 })); // dist 300
    expect(apart).toHaveLength(1);
    expect(Number.isFinite(apart[0].scale)).toBe(true);
    expect(apart[0].scale).toBeCloseTo(3, 5); // 300 / 100
  });

  it("emits no pan or tap during a pinch", () => {
    const gi = new TouchGestureInterpreter();
    const out: GestureIntent[] = [];
    out.push(...gi.handle({ phase: "down", id: 1, x: 0, y: 0 }));
    out.push(...gi.handle({ phase: "down", id: 2, x: 100, y: 0 }));
    out.push(...gi.handle({ phase: "move", id: 1, x: -50, y: 0 }));
    out.push(...gi.handle({ phase: "move", id: 2, x: 150, y: 0 }));
    out.push(...gi.handle({ phase: "up", id: 1, x: -50, y: 0 }));
    out.push(...gi.handle({ phase: "up", id: 2, x: 150, y: 0 }));
    expect(pans(out)).toHaveLength(0);
    expect(taps(out)).toHaveLength(0);
    expect(pinches(out).length).toBeGreaterThan(0);
  });
});

describe("TouchGestureInterpreter — multi-touch disambiguation & cleanup", () => {
  it("suppresses the tap on the finger that lifts after a pinch", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 100, y: 100 });
    gi.handle({ phase: "down", id: 2, x: 200, y: 100 });
    gi.handle({ phase: "move", id: 2, x: 250, y: 100 });
    const upA = gi.handle({ phase: "up", id: 1, x: 100, y: 100 });
    const upB = gi.handle({ phase: "up", id: 2, x: 250, y: 100 });
    expect(taps([...upA, ...upB])).toHaveLength(0);
  });

  it("lets the surviving finger pan with no jump after one finger lifts", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 100, y: 100 });
    gi.handle({ phase: "down", id: 2, x: 200, y: 100 });
    gi.handle({ phase: "move", id: 2, x: 260, y: 100 });
    gi.handle({ phase: "up", id: 2, x: 260, y: 100 }); // back to one finger (id 1)
    // id 1 sat at (100,100); now drag it — the first delta must be small, not a
    // jump to wherever the lifted finger was.
    const out = gi.handle({ phase: "move", id: 1, x: 130, y: 100 });
    const p = pans(out);
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ type: "pan", dx: 30, dy: 0 });
  });

  it("reset() clears state so a fresh tap is recognised", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 0, y: 0 });
    gi.handle({ phase: "down", id: 2, x: 100, y: 0 });
    expect(gi.activePointers).toBe(2);
    gi.reset();
    expect(gi.activePointers).toBe(0);
    const out = [
      gi.handle({ phase: "down", id: 9, x: 5, y: 5, t: 0 }),
      gi.handle({ phase: "up", id: 9, x: 5, y: 5, t: 30 }),
    ].flat();
    expect(taps(out)).toHaveLength(1);
  });

  it("a cancel ends the gesture without emitting a tap", () => {
    const gi = new TouchGestureInterpreter();
    gi.handle({ phase: "down", id: 1, x: 0, y: 0, t: 0 });
    const out = gi.handle({ phase: "cancel", id: 1, x: 0, y: 0, t: 10 });
    expect(out).toHaveLength(0);
    expect(gi.activePointers).toBe(0);
  });

  it("ignores a move/up for an unknown pointer id", () => {
    const gi = new TouchGestureInterpreter();
    expect(gi.handle({ phase: "move", id: 7, x: 1, y: 1 })).toHaveLength(0);
    expect(gi.handle({ phase: "up", id: 7, x: 1, y: 1 })).toHaveLength(0);
  });
});
