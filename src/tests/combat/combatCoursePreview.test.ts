import { describe, it, expect, vi } from "vitest";
import { previewCombatCourse } from "@/presentation/flight/combatCoursePreview";
import {
  combatReach,
  SHIP_ROTATION_SPEED,
} from "@/presentation/flight/combatTrajectory";
import { COMBAT_ROUND_MS } from "@/config/balance";

function fakeRenderer() {
  return {
    drawRoute: vi.fn(),
    drawNavigationMarker: vi.fn(),
  };
}
function fakeShip(maxSpeed: number, x = 0, y = 0, angle = 0) {
  return { getMaxSpeed: () => maxSpeed, shipX: x, shipY: y, shipAngle: angle };
}

describe("previewCombatCourse — planning-phase movement click wiring (Task 3)", () => {
  it("records the clicked destination on the plan and draws a preview + marker", () => {
    const renderer = fakeRenderer();
    const setDestination = vi.fn();
    const ship = fakeShip(0.11);

    const dest = previewCombatCourse(
      renderer as never,
      { setDestination },
      ship,
      100,
      0,
    );

    expect(dest).toEqual({ x: 100, y: 0 });
    expect(setDestination).toHaveBeenCalledWith({ x: 100, y: 0 });
    const drawn = renderer.drawRoute.mock.calls[0][0] as {
      x: number;
      y: number;
    }[];
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn[0]).toEqual({ x: 0, y: 0 }); // starts at the ship
    expect(renderer.drawNavigationMarker).toHaveBeenCalledWith(100, 0);
  });

  it("clamps a click beyond this round's reach back onto the reach circle", () => {
    const renderer = fakeRenderer();
    const setDestination = vi.fn();
    const ship = fakeShip(0.11);
    const reach = combatReach(
      { maxSpeed: 0.11, rotationSpeed: SHIP_ROTATION_SPEED },
      COMBAT_ROUND_MS,
    );

    const dest = previewCombatCourse(
      renderer as never,
      { setDestination },
      ship,
      100000,
      0,
    );

    expect(dest.x).toBeCloseTo(reach, 3);
    expect(dest.y).toBeCloseTo(0, 6);
    expect(setDestination).toHaveBeenCalledWith(dest);
  });
});
