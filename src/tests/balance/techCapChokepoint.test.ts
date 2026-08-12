import { describe, it, expect } from "vitest";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import { TECH_UPLIFT_DAYS, TECH_UPLIFT_CAP } from "@/config/balance";
import { GALAXY_MAX_TECH_FLOOR } from "@/systems/galaxy/systemTechDistribution";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { gearById } from "@/systems/equipment/GearCatalog";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

describe("tech-cap chokepoint loosened (plan Task 19)", () => {
  it("pins the day→cap curve for the galaxy's naturally-generated peak system", () => {
    expect(techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 0)).toBe(
      GALAXY_MAX_TECH_FLOOR,
    );
    expect(techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 300)).toBe(
      GALAXY_MAX_TECH_FLOOR + Math.floor(300 / TECH_UPLIFT_DAYS),
    );
    expect(techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 500)).toBe(
      GALAXY_MAX_TECH_FLOOR + Math.floor(500 / TECH_UPLIFT_DAYS),
    );
    expect(techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 10_000)).toBe(
      TECH_UPLIFT_CAP,
    );
  });

  it("a freshly generated galaxy already has a tech-6 system at day 0, no uplift needed", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "tech-cap-day-0",
      30,
    );
    const peak = Math.max(...galaxy.systems.map((s) => s.techLevel));
    expect(peak).toBeGreaterThanOrEqual(6);
  });

  it("the non-minDay-gated tech-6 engine matches the tech-6 hull's reachability by day 300", () => {
    const hull = gearById("hull_cruiser");
    const engine = gearById("eq_engine_iv");
    expect(hull?.techLevel).toBe(6);
    expect(engine?.techLevel).toBe(6);
    expect(hull?.minDay).toBeUndefined();
    expect(engine?.minDay).toBeUndefined();

    const capAtDay300 = techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 300);
    expect(capAtDay300).toBeGreaterThanOrEqual(6);
  });

  it("the tech-6 engine is actually stockable well before the campaign's late game (day 300)", () => {
    const maxTechLevel = techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 300);
    let stocked = 0;
    const PLANETS = 300;
    for (let i = 0; i < PLANETS; i++) {
      const listings = generateShop({
        systemId: "S",
        planetId: `P${i}`,
        seed: "tech-cap-chokepoint",
        day: 300,
        refreshEveryDays: 1_000_000,
        maxTechLevel,
      });
      if (listings.some((l) => l.gear.id === "eq_engine_iv")) stocked++;
    }
    expect(stocked).toBeGreaterThan(0);
  });
});
