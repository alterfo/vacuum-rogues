import { describe, it, expect } from "vitest";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import {
  GEAR_CATALOG,
  gearById,
  GearKind,
  EquipmentClass,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import { APEX_ENGINE_MIN_DAY } from "@/config/balance";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

describe("apex engine minDay gate (plan Task 6)", () => {
  const PLANETS = 300;
  const SAME_BUCKET = 1_000_000;

  function shopIds(planetId: string, day: number): Set<string> {
    return new Set(
      generateShop({
        systemId: "S",
        planetId,
        seed: "apex-gate",
        day,
        refreshEveryDays: SAME_BUCKET,
        maxTechLevel: 8,
      }).map((l) => l.gear.id),
    );
  }

  const DAY_GATED_IDS = new Set([
    "eq_engine_v",
    "hull_dreadnought",
    "hull_liberator",
    "wpn_lance_array",
    "wpn_aft_shredder",
    "wpn_nova_driver",
    "wpn_annihilator",
    "eq_engine_vi",
    "eq_shield_fortress",
    "eq_droid_swarm",
    "hull_marauder",
    "eq_engine_surge",
  ]);

  it("the day-gated set is exactly the apex engine plus the endgame band", () => {
    expect(gearById("eq_engine_v")?.minDay).toBe(APEX_ENGINE_MIN_DAY);
    for (const g of GEAR_CATALOG) {
      if (DAY_GATED_IDS.has(g.id)) {
        expect(g.minDay, `${g.id} must be day-gated`).toBeGreaterThan(0);
      } else {
        expect(g.minDay, `${g.id} must not be day-gated`).toBeUndefined();
      }
    }
  });

  it("never stocked before minDay, even at top tech across many shops", () => {
    let otherRareSeen = 0;
    for (let i = 0; i < PLANETS; i++) {
      const ids = shopIds(`P${i}`, APEX_ENGINE_MIN_DAY - 1);
      expect(ids.has("eq_engine_v")).toBe(false);
      if (ids.has("hull_bastion") || ids.has("wpn_torpedo")) otherRareSeen++;
    }
    expect(otherRareSeen).toBeGreaterThan(0);
  });

  it("can appear at/after minDay — a floor, not a guarantee", () => {
    let stocked = 0;
    let missing = 0;
    for (let i = 0; i < PLANETS; i++) {
      const ids = shopIds(`P${i}`, APEX_ENGINE_MIN_DAY);
      if (ids.has("eq_engine_v")) stocked++;
      else missing++;
    }
    expect(stocked).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0);
  });

  it("no un-gated engine matches the apex engine's top speed (the gate must not be bypassable)", () => {
    const apex = gearById("eq_engine_v") as EquipmentSpec;
    const apexLoadout = new ShipLoadout("hull_bastion");
    apexLoadout.install(apex.id);
    const apexSpeed = apexLoadout.derivedStats().speed;

    const ungatedEngines = GEAR_CATALOG.filter(
      (g): g is EquipmentSpec =>
        g.kind === GearKind.EQUIPMENT &&
        g.equipmentClass === EquipmentClass.ENGINE &&
        g.id !== apex.id &&
        g.minDay === undefined,
    );
    expect(ungatedEngines.length).toBeGreaterThan(0);
    for (const engine of ungatedEngines) {
      const loadout = new ShipLoadout("hull_bastion");
      loadout.install(engine.id);
      expect(
        loadout.derivedStats().speed,
        `${engine.id} must not match the calendar-gated apex engine's speed`,
      ).toBeLessThan(apexSpeed);
    }
  });

  it("every other item is untouched: same rng bucket differs only by eq_engine_v", () => {
    for (let i = 0; i < PLANETS; i++) {
      const before = shopIds(`P${i}`, APEX_ENGINE_MIN_DAY - 1);
      const after = shopIds(`P${i}`, APEX_ENGINE_MIN_DAY);
      const gained = [...after].filter((id) => !before.has(id));
      const lost = [...before].filter((id) => !after.has(id));
      expect(lost).toEqual([]);
      expect(gained.every((id) => id === "eq_engine_v")).toBe(true);
    }
  });
});
