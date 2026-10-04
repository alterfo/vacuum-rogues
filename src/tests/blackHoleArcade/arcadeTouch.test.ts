import { describe, it, expect } from "vitest";
import {
  ARCADE_FX_QUALITY,
  ARCADE_QUALITY_MAX_LEVEL,
  ARCADE_TOUCH_GAIN,
  AdaptiveQuality,
  RelativeDrag,
  type TouchBounds,
} from "@/systems/blackHoleArcade/arcadeTouch";

const BOUNDS: TouchBounds = { minX: 28, maxX: 692, minY: 28, maxY: 1052 };

describe("relative touch drag", () => {
  it("moves the ship by the finger's movement, not to the finger", () => {
    const drag = new RelativeDrag(1);
    drag.begin(1, 200, 600, 360, 900);
    expect(drag.move(1, 200, 600, 0.5, BOUNDS)).toEqual({ x: 360, y: 900 });
    expect(drag.move(1, 230, 580, 0.5, BOUNDS)).toEqual({ x: 420, y: 860 });
  });

  it("converts screen pixels to field units through the scale", () => {
    const drag = new RelativeDrag(1);
    drag.begin(1, 0, 0, 360, 900);
    const a = drag.move(1, 10, 0, 0.5, BOUNDS)!;
    expect(a.x).toBeCloseTo(380, 5);
    const drag2 = new RelativeDrag(1);
    drag2.begin(1, 0, 0, 360, 900);
    expect(drag2.move(1, 10, 0, 1, BOUNDS)!.x).toBeCloseTo(370, 5);
  });

  it("amplifies slightly so a short swipe covers the field", () => {
    const drag = new RelativeDrag();
    drag.begin(1, 0, 0, 100, 500);
    const moved = drag.move(1, 100, 0, 1, BOUNDS)!;
    expect(moved.x - 100).toBeCloseTo(100 * ARCADE_TOUCH_GAIN, 5);
    expect(ARCADE_TOUCH_GAIN).toBeGreaterThan(1);
  });

  it("clamps at the edges without storing hidden overshoot", () => {
    const drag = new RelativeDrag(1);
    drag.begin(1, 0, 0, 600, 500);
    expect(drag.move(1, 5000, 0, 1, BOUNDS)!.x).toBe(692);
    expect(drag.move(1, 4990, 0, 1, BOUNDS)!.x).toBe(682);
  });

  it("only follows the finger that started it", () => {
    const drag = new RelativeDrag(1);
    drag.begin(7, 0, 0, 360, 900);
    expect(drag.move(8, 100, 100, 1, BOUNDS)).toBeNull();
    expect(drag.activeId).toBe(7);
    expect(drag.end(8)).toBe(false);
    expect(drag.end(7)).toBe(true);
    expect(drag.activeId).toBeNull();
    expect(drag.move(7, 1, 1, 1, BOUNDS)).toBeNull();
  });

  it("ignores a degenerate scale", () => {
    const drag = new RelativeDrag(1);
    drag.begin(1, 0, 0, 360, 900);
    expect(drag.move(1, 50, 50, 0, BOUNDS)).toBeNull();
  });

  it("a new touch re-anchors on the ship's current position", () => {
    const drag = new RelativeDrag(1);
    drag.begin(1, 0, 0, 360, 900);
    drag.move(1, 50, 0, 1, BOUNDS);
    drag.end(1);
    drag.begin(2, 400, 400, 410, 900);
    expect(drag.move(2, 400, 400, 1, BOUNDS)).toEqual({ x: 410, y: 900 });
  });
});

describe("adaptive effect quality", () => {
  const feed = (q: AdaptiveQuality, ms: number, frames: number) => {
    for (let i = 0; i < frames; i++) q.sample(ms);
  };

  it("stays on the best level while frames are fast", () => {
    const q = new AdaptiveQuality(0);
    feed(q, 16.7, 2000);
    expect(q.level).toBe(0);
  });

  it("drops a level after a sustained slowdown, then waits before dropping again", () => {
    const q = new AdaptiveQuality(0);
    feed(q, 40, 150);
    expect(q.level).toBe(1);
    feed(q, 40, 100);
    expect(q.level).toBe(1);
    feed(q, 40, 500);
    expect(q.level).toBe(ARCADE_QUALITY_MAX_LEVEL);
  });

  it("never goes below the lowest level, and never climbs back on its own", () => {
    const q = new AdaptiveQuality(0);
    feed(q, 60, 3000);
    expect(q.level).toBe(ARCADE_QUALITY_MAX_LEVEL);
    feed(q, 8, 3000);
    expect(q.level).toBe(ARCADE_QUALITY_MAX_LEVEL);
  });

  it("ignores one-off hitches such as tab switches", () => {
    const q = new AdaptiveQuality(0);
    for (let i = 0; i < 40; i++) {
      feed(q, 16.7, 20);
      q.sample(900);
      q.sample(0);
    }
    expect(q.level).toBe(0);
  });

  it("can start degraded (phones) and clamps its start level", () => {
    expect(new AdaptiveQuality(1).level).toBe(1);
    expect(new AdaptiveQuality(99).level).toBe(ARCADE_QUALITY_MAX_LEVEL);
    expect(new AdaptiveQuality(-4).level).toBe(0);
  });

  it("each level is strictly cheaper than the one before", () => {
    for (let i = 1; i < ARCADE_FX_QUALITY.length; i++) {
      expect(ARCADE_FX_QUALITY[i].particleCap).toBeLessThan(
        ARCADE_FX_QUALITY[i - 1].particleCap,
      );
      expect(ARCADE_FX_QUALITY[i].sparkScale).toBeLessThan(
        ARCADE_FX_QUALITY[i - 1].sparkScale,
      );
    }
  });
});
