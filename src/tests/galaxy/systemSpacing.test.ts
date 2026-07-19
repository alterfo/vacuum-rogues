/**
 * Galaxy system-spacing guarantee (live report 2026-07-19): a screenshot from
 * a real session showed two-three star-map system markers (and their name
 * labels) rendered directly on top of each other — completely unreadable.
 * Root cause: `GalaxySimulator.generateGalaxy`'s coordinate generation
 * (`coord = { q: rng.nextInt(-50,50), r: rng.nextInt(-50,50) }`) picks each
 * system's position independently and uniformly at random with no minimum
 * inter-system distance — with `DEFAULT_SYSTEM_COUNT` up to 30+ systems in a
 * 100×100 grid, two systems landing within a few units of each other is a
 * real, reproducible outcome, not a rare edge case.
 *
 * `MIN_SYSTEM_DISTANCE` (`GalaxySimulator.ts`) is the fix: reject-and-retry
 * coordinate generation until every new system clears this distance from
 * every already-placed one (falling back to the best of a bounded number of
 * attempts at very high system counts, so generation always terminates).
 * `StarMapScene`'s existing `pickLabelPosition` collision avoidance can then
 * actually find a clear spot, since the underlying markers are no longer
 * touching in the first place.
 *
 * Pure galaxy-generation change — new-games-only, no schema/migration impact
 * (`SaveStateSchema.galaxy` persists whatever coordinates a save already has).
 */
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
    // 50, not SaveStateSchema's max of 100: SystemNameGenerator only supports
    // up to 55 unique names today, a separate pre-existing limit unrelated to
    // this spacing fix.
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("SPACING-DENSE", 50);
    expect(galaxy.systems).toHaveLength(50);
    // Coordinates must still be unique even if the ideal distance can't be
    // met for every pair at this density — no two systems on the exact same point.
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
