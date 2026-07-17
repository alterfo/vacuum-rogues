import { describe, it, expect, vi } from "vitest";
import { drawWeaponRangeCircles } from "@/presentation/flight/combatWeaponRangeOverlay";
import {
  weaponRangeCircles,
  type RangedWeapon,
} from "@/presentation/flight/combatWeaponTargeting";

// Minimal fake Graphics recorder — the seam only touches these four methods.
function fakeGraphics() {
  return {
    clear: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
  };
}

function weapon(id: string, range: number): RangedWeapon {
  return { id, range };
}

describe("drawWeaponRangeCircles — per-weapon range overlay draw (Task 5)", () => {
  it("clears then strokes one dashed ring per weapon in that weapon's colour", () => {
    const g = fakeGraphics();
    const circles = weaponRangeCircles([weapon("a", 240), weapon("b", 360)], {
      x: 0,
      y: 0,
    });
    drawWeaponRangeCircles(g as never, circles);

    expect(g.clear).toHaveBeenCalledTimes(1);
    // One stroke per (positive-radius) circle, each in its own colour.
    expect(g.stroke).toHaveBeenCalledTimes(2);
    expect(g.stroke.mock.calls[0][0].color).toBe(circles[0].color);
    expect(g.stroke.mock.calls[1][0].color).toBe(circles[1].color);
    // Dashes were drawn (arc + moveTo used).
    expect(g.arc).toHaveBeenCalled();
    expect(g.moveTo).toHaveBeenCalled();
  });

  it("skips a zero-radius circle (no stroke for it)", () => {
    const g = fakeGraphics();
    const circles = weaponRangeCircles([weapon("a", 0), weapon("b", 200)], {
      x: 0,
      y: 0,
    });
    drawWeaponRangeCircles(g as never, circles);
    expect(g.stroke).toHaveBeenCalledTimes(1);
    expect(g.stroke.mock.calls[0][0].color).toBe(circles[1].color);
  });

  it("no-op-safe on an empty list (clears, strokes nothing)", () => {
    const g = fakeGraphics();
    drawWeaponRangeCircles(g as never, []);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.stroke).not.toHaveBeenCalled();
  });
});
