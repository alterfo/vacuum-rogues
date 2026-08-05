import { describe, it, expect } from "vitest";
import { planetApproachPoint } from "@/utils/flightGeometry";

describe("planetApproachPoint", () => {
  it("places the endpoint outside the planet radius", () => {
    const planet = { x: 500, y: 500 };
    const ship = { x: 0, y: 500 };
    const radius = 60;
    const offset = 80;

    const pt = planetApproachPoint(
      ship.x,
      ship.y,
      planet.x,
      planet.y,
      radius,
      offset,
    );

    const distToCenter = Math.hypot(pt.x - planet.x, pt.y - planet.y);
    expect(distToCenter).toBeCloseTo(radius + offset);
  });

  it("endpoint does not overlap the planet disc", () => {
    const cases = [
      { ship: { x: 0, y: 0 }, planet: { x: 1000, y: 0 } },
      { ship: { x: 0, y: 0 }, planet: { x: 0, y: 800 } },
      { ship: { x: 500, y: 500 }, planet: { x: 100, y: 200 } },
    ];
    const radius = 80;
    const offset = 80;

    for (const { ship, planet } of cases) {
      const pt = planetApproachPoint(
        ship.x,
        ship.y,
        planet.x,
        planet.y,
        radius,
        offset,
      );
      const distToCenter = Math.hypot(pt.x - planet.x, pt.y - planet.y);
      expect(distToCenter).toBeGreaterThanOrEqual(radius - 0.001);
    }
  });

  it("endpoint lies on the line between ship and planet center", () => {
    const ship = { x: 0, y: 0 };
    const planet = { x: 600, y: 0 };
    const radius = 50;
    const offset = 80;

    const pt = planetApproachPoint(
      ship.x,
      ship.y,
      planet.x,
      planet.y,
      radius,
      offset,
    );

    expect(pt.y).toBeCloseTo(0);
    expect(pt.x).toBeGreaterThan(ship.x);
    expect(pt.x).toBeLessThan(planet.x);
  });

  it("handles degenerate case where ship is at planet center", () => {
    const pt = planetApproachPoint(100, 100, 100, 100, 50, 80);
    const distToCenter = Math.hypot(pt.x - 100, pt.y - 100);
    expect(distToCenter).toBeCloseTo(50 + 80);
  });
});
