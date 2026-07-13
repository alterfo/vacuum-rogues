import { describe, it, expect, vi } from "vitest";
import {
  drawShipStatusBars,
  HULL_BAR_COLOR,
  SHIELD_BAR_COLOR,
  BAR_BG_COLOR,
  type ShipStatusBarSpec,
  type StatusBarGeometry,
} from "@/presentation/flight/combatStatusBars";
import { SHIELD_COMBAT } from "@/config/balance";

// Minimal fake Graphics recorder — the seam only touches these three methods.
function fakeGraphics() {
  const calls: { x: number; y: number; w: number; h: number }[] = [];
  return {
    calls,
    clear: vi.fn(),
    roundRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ x, y, w, h });
    }),
    fill: vi.fn(),
  };
}

const geom: StatusBarGeometry = {
  barWidth: SHIELD_COMBAT.barWidth,
  barHeight: SHIELD_COMBAT.barHeight,
  barGap: SHIELD_COMBAT.barGap,
  barYOffset: SHIELD_COMBAT.barYOffset,
};

function ship(over: Partial<ShipStatusBarSpec> = {}): ShipStatusBarSpec {
  return {
    x: 0,
    y: 0,
    hull: 50,
    maxHull: 100,
    shields: 40,
    maxShields: 80,
    ...over,
  };
}

describe("drawShipStatusBars — floating hull/shield bars (Task 12)", () => {
  it("draws a hull track+fill and a shield track+fill for a shielded ship", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [ship()], geom);
    expect(g.clear).toHaveBeenCalledTimes(1);
    // 2 tracks + 2 fills = 4 rounded rects for a half-hull, half-shield ship.
    expect(g.roundRect).toHaveBeenCalledTimes(4);
    const fillColors = g.fill.mock.calls.map((c) => c[0].color);
    expect(fillColors).toContain(HULL_BAR_COLOR);
    expect(fillColors).toContain(SHIELD_BAR_COLOR);
    expect(fillColors).toContain(BAR_BG_COLOR);
  });

  it("bar fill widths match the hull/shield fractions", () => {
    const g = fakeGraphics();
    drawShipStatusBars(
      g as never,
      [ship({ hull: 25, maxHull: 100, shields: 20, maxShields: 80 })],
      geom,
    );
    // Track widths are full barWidth; fill widths are frac × barWidth.
    const widths = g.calls.map((c) => c.w);
    expect(widths).toContain(geom.barWidth); // full-width tracks
    expect(widths).toContain(geom.barWidth * 0.25); // hull fill 25/100
    expect(widths).toContain(geom.barWidth * 0.25); // shield fill 20/80 = 0.25 too
  });

  it("centres the bar on the ship x and floats it above the ship y", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [ship({ x: 200, y: 100 })], geom);
    // Hull track left edge = x - width/2; the whole stack is above y (y - yOffset ...).
    for (const c of g.calls) {
      expect(c.x).toBeCloseTo(200 - geom.barWidth / 2);
      expect(c.y).toBeLessThan(100); // floats above the ship centre
    }
  });

  it("shield bar sits above the hull bar", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [ship()], geom);
    const ys = g.calls.map((c) => c.y);
    const minY = Math.min(...ys); // shield row
    const maxY = Math.max(...ys); // hull row
    expect(maxY - minY).toBeCloseTo(geom.barHeight + geom.barGap);
  });

  it("a shield-less ship (no/zero maxShields) shows only a hull bar", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [ship({ maxShields: 0 })], geom);
    // Only hull track + fill = 2 rects, no empty shield slot.
    expect(g.roundRect).toHaveBeenCalledTimes(2);
    const fillColors = g.fill.mock.calls.map((c) => c[0].color);
    expect(fillColors).not.toContain(SHIELD_BAR_COLOR);
  });

  it("a ship missing the shields field entirely draws hull only", () => {
    const g = fakeGraphics();
    drawShipStatusBars(
      g as never,
      [{ x: 0, y: 0, hull: 30, maxHull: 60 }],
      geom,
    );
    expect(g.roundRect).toHaveBeenCalledTimes(2);
  });

  it("an empty hull draws only the background track (no hull fill)", () => {
    const g = fakeGraphics();
    drawShipStatusBars(
      g as never,
      [ship({ hull: 0, maxHull: 100, maxShields: 0 })],
      geom,
    );
    // Hull track only — no fill rect for a 0-width bar.
    expect(g.roundRect).toHaveBeenCalledTimes(1);
    expect(g.fill.mock.calls.map((c) => c[0].color)).not.toContain(
      HULL_BAR_COLOR,
    );
  });

  it("a ship with non-positive maxHull draws nothing", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [ship({ maxHull: 0 })], geom);
    expect(g.roundRect).not.toHaveBeenCalled();
  });

  it("honours an enemy hull colour override", () => {
    const g = fakeGraphics();
    drawShipStatusBars(
      g as never,
      [ship({ hullColor: 0xff4444, maxShields: 0 })],
      geom,
    );
    expect(g.fill.mock.calls.map((c) => c[0].color)).toContain(0xff4444);
  });

  it("no-op-safe on an empty list (clears, draws nothing)", () => {
    const g = fakeGraphics();
    drawShipStatusBars(g as never, [], geom);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.roundRect).not.toHaveBeenCalled();
  });
});
