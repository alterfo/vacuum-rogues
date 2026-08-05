import { describe, it, expect } from "vitest";
import { planetSpin } from "@/presentation/PlanetSprite";

const SLOWEST = 1 / 60000; // ~60 s per rotation
const FASTEST = 1 / 12000; // ~12 s per rotation

describe("planetSpin (varied per-planet axial rotation)", () => {
  it("is deterministic for a given id", () => {
    expect(planetSpin("planet-7")).toEqual(planetSpin("planet-7"));
  });

  it("distinct ids give distinct speed and/or direction", () => {
    const a = planetSpin("alpha-3");
    const b = planetSpin("beta-9");
    const identical = a.speed === b.speed && a.direction === b.direction;
    expect(identical).toBe(false);
  });

  it("speeds fall in the visible band (~one rotation per 12–60 s)", () => {
    for (let i = 0; i < 300; i++) {
      const { speed } = planetSpin(`p-${i}`);
      expect(speed).toBeGreaterThanOrEqual(SLOWEST);
      expect(speed).toBeLessThanOrEqual(FASTEST);
      const periodSeconds = 1 / speed / 1000;
      expect(periodSeconds).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(periodSeconds).toBeLessThanOrEqual(60 + 1e-6);
    }
  });

  it("direction is ±1 and well-mixed across a sample (not all one sign)", () => {
    const N = 300;
    let prograde = 0;
    let retrograde = 0;
    for (let i = 0; i < N; i++) {
      const { direction } = planetSpin(`world-${i}`);
      expect(Math.abs(direction)).toBe(1);
      if (direction > 0) prograde++;
      else retrograde++;
    }
    expect(prograde).toBeGreaterThan(N * 0.3);
    expect(retrograde).toBeGreaterThan(N * 0.3);
  });

  it("has a wide speed spread (perceptible variety, not a single rate)", () => {
    const speeds = Array.from(
      { length: 300 },
      (_, i) => planetSpin(`s-${i}`).speed,
    );
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    expect(max / min).toBeGreaterThan(3);
  });
});
