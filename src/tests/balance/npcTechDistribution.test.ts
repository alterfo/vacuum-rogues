import { describe, it, expect } from "vitest";
import { npcRoleTechLevel, NPC_TECH_BAND } from "@/systems/npc/NpcSimulator";
import { NpcRole } from "@/types";
import { RARE_TECH_THRESHOLD } from "@/config/balance";
import { SeededRNG } from "@/utils/seededRNG";

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
    expect(NPC_TECH_BAND.max).toBeLessThan(RARE_TECH_THRESHOLD);
    for (const role of SEEDED_ROLES) {
      expect(npcRoleTechLevel(role)).toBeLessThan(RARE_TECH_THRESHOLD);
    }
  });

  it("the tech spread across roles is tight (no wild disparities)", () => {
    const techs = SEEDED_ROLES.map(npcRoleTechLevel);
    const spread = Math.max(...techs) - Math.min(...techs);
    expect(spread).toBeLessThanOrEqual(2);
  });

  it("a generated galaxy's NPC tech has low variance (clustered mid-tier)", () => {
    const rng = new SeededRNG("npc-tech-distribution");
    const sample: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const role = SEEDED_ROLES[rng.nextInt(0, SEEDED_ROLES.length - 1)];
      sample.push(npcRoleTechLevel(role));
    }
    const m = mean(sample);
    expect(m).toBeGreaterThan(1.5);
    expect(m).toBeLessThan(2.5);
    expect(variance(sample)).toBeLessThan(1.0);
    expect(Math.max(...sample)).toBeLessThan(RARE_TECH_THRESHOLD);
  });
});
