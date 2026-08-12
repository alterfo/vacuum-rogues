import { describe, it, expect } from "vitest";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { gearById } from "@/systems/equipment/GearCatalog";
import { APEX_ENGINE_MIN_DAY } from "@/config/balance";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import { GALAXY_MAX_TECH_FLOOR } from "@/systems/galaxy/systemTechDistribution";

describe("top hull has a reachable matching engine (plan Task 18)", () => {
  const PLANETS = 300;

  it("the apex engine's minDay lines up with the top hull it's meant to arm", () => {
    const hull = gearById("hull_dreadnought");
    const engine = gearById("eq_engine_v");
    expect(engine?.minDay).toBe(APEX_ENGINE_MIN_DAY);
    expect(hull?.minDay).toBeLessThanOrEqual(APEX_ENGINE_MIN_DAY);
    expect(APEX_ENGINE_MIN_DAY - hull!.minDay!).toBeLessThanOrEqual(30);
  });

  it("a fully-uplifted system's tech cap reaches the apex engine's tech level by its minDay", () => {
    const engine = gearById("eq_engine_v");
    const cap = techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, APEX_ENGINE_MIN_DAY);
    expect(cap).toBeGreaterThanOrEqual(engine!.techLevel);
  });

  it("the apex engine is actually stockable at a realistic uplifted system on its minDay", () => {
    const maxTechLevel = techLevelWithUplift(
      GALAXY_MAX_TECH_FLOOR,
      APEX_ENGINE_MIN_DAY,
    );
    let stocked = 0;
    for (let i = 0; i < PLANETS; i++) {
      const listings = generateShop({
        systemId: "S",
        planetId: `P${i}`,
        seed: "apex-hull-match",
        day: APEX_ENGINE_MIN_DAY,
        refreshEveryDays: 1_000_000,
        maxTechLevel,
      });
      if (listings.some((l) => l.gear.id === "eq_engine_v")) stocked++;
    }
    expect(stocked).toBeGreaterThan(0);
  });
});
