import { describe, it, expect } from "vitest";
import { npcRoleTechLevel, NPC_TECH_BAND } from "@/systems/npc/NpcSimulator";
import { NpcRole } from "@/types";
import { RARE_TECH_THRESHOLD } from "@/config/balance";
import { SeededRNG } from "@/utils/seededRNG";

// ---------------------------------------------------------------------------
// Task 3: the galaxy's NPC tech must be HOMOGENEOUS — most ships run similar
// mid-tech (no wild disparities), so a fresh player is never randomly outclassed
// by a *common* ship. The rare high-end (apex hull/engine, tech ≥ threshold) is
// reserved for the player's long climb and the richest markets, never seeded onto
// a common wandering NPC. Assert the *distribution shape* (tight band, low
// variance, no rare tech), not exact per-role magnitudes, so the homogeneity
// property is locked while leaving room to tune.
// ---------------------------------------------------------------------------

/** The four roles the NPC seeding picks from, uniformly (spawnOne/spawnOneInSystem). */
const SEEDED_ROLES: NpcRole[] = [
  NpcRole.RANGER,
  NpcRole.TRADER,
  NpcRole.PIRATE,
  NpcRole.PATROL,
];

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function variance(xs: number[]): number {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

describe("homogeneous NPC tech distribution (Task 3)", () => {
  it("every seeded role's tech sits inside the homogeneous mid-tier band", () => {
    for (const role of SEEDED_ROLES) {
      const tech = npcRoleTechLevel(role);
      expect(tech, `${role} below band`).toBeGreaterThanOrEqual(
        NPC_TECH_BAND.min,
      );
      expect(tech, `${role} above band`).toBeLessThanOrEqual(NPC_TECH_BAND.max);
    }
  });

  it("the whole NPC tech band is below the rare apex threshold (never apex)", () => {
    // No common NPC ever fields rare, high-end (tech ≥ RARE_TECH_THRESHOLD) gear.
    expect(NPC_TECH_BAND.max).toBeLessThan(RARE_TECH_THRESHOLD);
    for (const role of SEEDED_ROLES) {
      expect(npcRoleTechLevel(role)).toBeLessThan(RARE_TECH_THRESHOLD);
    }
  });

  it("the tech spread across roles is tight (no wild disparities)", () => {
    const techs = SEEDED_ROLES.map(npcRoleTechLevel);
    const spread = Math.max(...techs) - Math.min(...techs);
    // A homogeneous galaxy: the gap between the lowest- and highest-teched
    // *common* ship is at most a couple of tiers — not the full catalog range.
    expect(spread).toBeLessThanOrEqual(2);
  });

  it("a generated galaxy's NPC tech has low variance (clustered mid-tier)", () => {
    // Replicate the seeding's uniform role pick over a large deterministic sample
    // and confirm the realised tech distribution is tightly clustered, with the
    // mean sitting in the mid-tier rather than spread across the catalog.
    const rng = new SeededRNG("npc-tech-distribution");
    const sample: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const role = SEEDED_ROLES[rng.nextInt(0, SEEDED_ROLES.length - 1)];
      sample.push(npcRoleTechLevel(role));
    }
    const m = mean(sample);
    // Centred on the mid-tier (≈ tech 2), not skewed to either extreme.
    expect(m).toBeGreaterThan(1.5);
    expect(m).toBeLessThan(2.5);
    // Low variance ⇒ homogeneous. The spread of a uniform [1,2,2,3] mapping has
    // variance 0.5; allow generous headroom so future re-weighting stays valid
    // as long as the galaxy remains homogeneous.
    expect(variance(sample)).toBeLessThan(1.0);
    // And nothing in the realised population is ever a rare apex ship.
    expect(Math.max(...sample)).toBeLessThan(RARE_TECH_THRESHOLD);
  });
});
