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

/**
 * Overmind plan Task 6: the apex engine `eq_engine_v` is calendar-gated — it
 * never appears in any shop before {@link APEX_ENGINE_MIN_DAY} (~year 3),
 * regardless of the system's tech level or the per-shop stock roll. At/after
 * that day it becomes *possible* (still subject to the ordinary stock-chance
 * roll — a floor, not a guarantee). No other catalog item is affected.
 */
describe("apex engine minDay gate (plan Task 6)", () => {
  const PLANETS = 300;
  /** One giant refresh window so days on both sides of the gate share the
   *  same rng bucket — isolating the day gate as the only variable. */
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

  it("only eq_engine_v carries the minDay gate, set to APEX_ENGINE_MIN_DAY", () => {
    expect(gearById("eq_engine_v")?.minDay).toBe(APEX_ENGINE_MIN_DAY);
    for (const g of GEAR_CATALOG) {
      if (g.id === "eq_engine_v") continue;
      expect(g.minDay, `${g.id} must not be day-gated`).toBeUndefined();
    }
  });

  it("never stocked before minDay, even at top tech across many shops", () => {
    let otherRareSeen = 0;
    for (let i = 0; i < PLANETS; i++) {
      const ids = shopIds(`P${i}`, APEX_ENGINE_MIN_DAY - 1);
      expect(ids.has("eq_engine_v")).toBe(false);
      // Prove the sweep is meaningful: other rare tech-7 gear DOES show up
      // at this tech level — only the day gate is filtering the apex engine.
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
    // The ordinary stock-chance roll still applies on both sides.
    expect(stocked).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0);
  });

  it("no un-gated engine matches the apex engine's top speed (the gate must not be bypassable)", () => {
    const apex = gearById("eq_engine_v") as EquipmentSpec;
    const apexLoadout = new ShipLoadout("hull_bastion");
    apexLoadout.install(apex.id);
    const apexSpeed = apexLoadout.derivedStats().speed;

    const otherEngines = GEAR_CATALOG.filter(
      (g): g is EquipmentSpec =>
        g.kind === GearKind.EQUIPMENT &&
        g.equipmentClass === EquipmentClass.ENGINE &&
        g.id !== apex.id,
    );
    for (const engine of otherEngines) {
      expect(engine.minDay, engine.id).toBeUndefined();
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
