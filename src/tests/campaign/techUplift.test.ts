import { describe, it, expect } from "vitest";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import { TECH_UPLIFT_DAYS, TECH_UPLIFT_CAP } from "@/config/balance";
import { GALAXY_MAX_TECH_FLOOR } from "@/systems/galaxy/systemTechDistribution";
import {
  GEAR_CATALOG,
  GearKind,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";

describe("techLevelWithUplift — shops grow past the generated 1..5 tech band over the campaign", () => {
  it("day 0 keeps the generated tech level", () => {
    expect(techLevelWithUplift(3, 0)).toBe(3);
    expect(techLevelWithUplift(5, -10)).toBe(5);
    expect(techLevelWithUplift(5, NaN)).toBe(5);
  });

  it("+1 per uplift period, capped at the max tech", () => {
    expect(techLevelWithUplift(3, TECH_UPLIFT_DAYS)).toBe(4);
    expect(techLevelWithUplift(3, 2 * TECH_UPLIFT_DAYS)).toBe(5);
    expect(techLevelWithUplift(5, 10 * TECH_UPLIFT_DAYS)).toBe(TECH_UPLIFT_CAP);
  });

  it("the best generated system reaches the full tech-8 catalog within the campaign", () => {
    const maxCatalogTech = Math.max(...GEAR_CATALOG.map((g) => g.techLevel));
    const periodsNeeded = maxCatalogTech - GALAXY_MAX_TECH_FLOOR;
    const dayReached = periodsNeeded * TECH_UPLIFT_DAYS;
    expect(dayReached).toBeLessThanOrEqual(900);
    expect(techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, dayReached)).toBe(
      maxCatalogTech,
    );
  });

  it("every endgame hull/weapon is purchasable by its minDay in an uplifted top system", () => {
    for (const gear of GEAR_CATALOG) {
      if (gear.minDay === undefined) continue;
      const techAtUnlock = techLevelWithUplift(
        GALAXY_MAX_TECH_FLOOR,
        gear.minDay,
      );
      expect(
        techAtUnlock,
        `${gear.id} unlocks at day ${gear.minDay} but needs tech ${gear.techLevel}`,
      ).toBeGreaterThanOrEqual(gear.techLevel);
    }
  });

  it("hull HP keeps strictly growing across the unlock timeline (progression ladder)", () => {
    const gatedHulls = GEAR_CATALOG.filter(
      (g): g is HullSpec => g.kind === GearKind.HULL && g.minDay !== undefined,
    ).sort((a, b) => (a.minDay ?? 0) - (b.minDay ?? 0));
    let prevHp = Math.max(
      ...GEAR_CATALOG.filter(
        (g): g is HullSpec =>
          g.kind === GearKind.HULL && g.minDay === undefined,
      ).map((h) => h.hp),
    );
    for (const hull of gatedHulls) {
      expect(hull.hp, hull.id).toBeGreaterThan(prevHp);
      prevHp = hull.hp;
    }
  });
});
