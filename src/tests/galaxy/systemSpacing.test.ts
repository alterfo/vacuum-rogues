import { describe, it, expect } from "vitest";
import {
  GalaxySimulator,
  MIN_SYSTEM_DISTANCE,
} from "@/systems/GalaxySimulator";

function pairwiseDistances(
  systems: { coordinates: { q: number; r: number } }[],
): number[] {
  const distances: number[] = [];
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      const dq = systems[i].coordinates.q - systems[j].coordinates.q;
      const dr = systems[i].coordinates.r - systems[j].coordinates.r;
      distances.push(Math.hypot(dq, dr));
    }
  }
  return distances;
}

describe("GalaxySimulator — minimum inter-system spacing (live report 2026-07-19)", () => {
  it("every pair of systems clears MIN_SYSTEM_DISTANCE across a spread of seeds/counts", async () => {
    const seeds = [
      "SPACING-0",
      "SPACING-1",
      "SPACING-2",
      "SPACING-3",
      "SPACING-4",
      "CAMPAIGN-CAPACITY-0",
      "LETSPLAY_WARP_TARGETING_SESSION_1",
    ];
    const counts = [5, 12, 30];
    for (const seed of seeds) {
      for (const count of counts) {
        const sim = new GalaxySimulator();
        const galaxy = await sim.generateGalaxy(seed, count);
        const distances = pairwiseDistances(galaxy.systems);
        const worst = Math.min(...distances);
        expect(
          worst,
          `seed=${seed} count=${count}: closest pair is ${worst.toFixed(2)} units apart, need >= ${MIN_SYSTEM_DISTANCE}`,
        ).toBeGreaterThanOrEqual(MIN_SYSTEM_DISTANCE);
      }
    }
  }, 30_000);

  it("still terminates and places every system at a high count (graceful degradation)", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("SPACING-DENSE", 50);
    expect(galaxy.systems).toHaveLength(50);
    const seen = new Set(
      galaxy.systems.map((s) => `${s.coordinates.q},${s.coordinates.r}`),
    );
    expect(seen.size).toBe(50);
  }, 30_000);

  it("is deterministic — the same seed/count reproduces identical coordinates", async () => {
    const a = await new GalaxySimulator().generateGalaxy("SPACING-DETERM", 15);
    const b = await new GalaxySimulator().generateGalaxy("SPACING-DETERM", 15);
    expect(a.systems.map((s) => s.coordinates)).toEqual(
      b.systems.map((s) => s.coordinates),
    );
  });
});
