import { describe, it, expect } from "vitest";
import {
  gearById,
  slotCategoryFor,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

const gear = (id: string): Gear => gearById(id)!;

describe("slotCategoryFor — gear → slot bank", () => {
  it("weapons go to the weapon bank", () => {
    expect(slotCategoryFor(gear("wpn_pulse"))).toBe("weapon");
    expect(slotCategoryFor(gear("wpn_torpedo"))).toBe("weapon");
  });

  it("the engine takes its own single slot", () => {
    expect(slotCategoryFor(gear("eq_engine_i"))).toBe("engine");
    expect(slotCategoryFor(gear("eq_engine_iii"))).toBe("engine");
  });

  it("the radar takes its own single slot", () => {
    expect(slotCategoryFor(gear("eq_radar"))).toBe("radar");
  });

  it("every other equipment family shares the additional-equipment bank", () => {
    for (const id of [
      "eq_tank", // fuel tank
      "eq_scanner",
      "eq_droid", // repair droid
      "eq_shield",
      "grav_tractor_2",
    ]) {
      expect(slotCategoryFor(gear(id))).toBe("equipment");
    }
  });

  it("a hull is the ship, not a slottable item (no category)", () => {
    expect(slotCategoryFor(gear("hull_scout"))).toBeUndefined();
  });
});

describe("ShipLoadout — per-category capacity from the hull", () => {
  it("reports each hull's category totals via derivedStats", () => {
    const scout = new ShipLoadout("hull_scout").derivedStats().categories;
    expect(scout.weapon.total).toBe(2);
    expect(scout.equipment.total).toBe(2);
    expect(scout.engine.total).toBe(1);
    expect(scout.radar.total).toBe(1);

    const courier = new ShipLoadout("hull_courier").derivedStats().categories;
    expect(courier.weapon.total).toBe(1);
    expect(courier.equipment.total).toBe(4);

    const bastion = new ShipLoadout("hull_bastion").derivedStats().categories;
    expect(bastion.weapon.total).toBe(4);
    expect(bastion.equipment.total).toBe(5);
  });

  it("tracks per-category usage as gear is installed", () => {
    const lo = new ShipLoadout("hull_warden"); // weapon 3 / equipment 4
    lo.install("wpn_pulse");
    lo.install("eq_engine_i");
    lo.install("eq_radar");
    lo.install("eq_tank");
    const c = lo.derivedStats().categories;
    expect(c.weapon).toEqual({ used: 1, total: 3 });
    expect(c.engine).toEqual({ used: 1, total: 1 });
    expect(c.radar).toEqual({ used: 1, total: 1 });
    expect(c.equipment).toEqual({ used: 1, total: 4 });
  });

  it("rejects an over-capacity weapon (a 2-weapon hull refuses a 3rd)", () => {
    const lo = new ShipLoadout("hull_scout"); // weaponSlots 2
    expect(lo.install("wpn_pulse")).toBe(true);
    expect(lo.install("wpn_railgun")).toBe(true);
    expect(lo.canInstall("wpn_scatter")).toBe(false);
    expect(lo.install("wpn_scatter")).toBe(false);
    expect(lo.derivedStats().categories.weapon.used).toBe(2);
  });

  it("rejects over-capacity additional equipment but not a free other bank", () => {
    const lo = new ShipLoadout("hull_scout"); // equipmentSlots 2
    expect(lo.install("eq_tank")).toBe(true);
    expect(lo.install("eq_scanner")).toBe(true);
    expect(lo.canInstall("eq_droid")).toBe(false);
    expect(lo.install("eq_droid")).toBe(false);
    expect(lo.canInstall("wpn_pulse")).toBe(true);
    expect(lo.install("wpn_pulse")).toBe(true);
  });
});

describe("ShipLoadout — single dedicated engine / radar slots", () => {
  it("a second engine replaces the first (one engine slot, no stacking)", () => {
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.install("eq_engine_i")).toBe(true);
    expect(lo.canInstall("eq_engine_iii")).toBe(true);
    expect(lo.install("eq_engine_iii")).toBe(true);
    expect(
      lo.installedGearIds().filter((id) => id.startsWith("eq_engine")),
    ).toEqual(["eq_engine_iii"]);
    expect(lo.derivedStats().categories.engine).toEqual({ used: 1, total: 1 });
  });

  it("a second radar replaces the first", () => {
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.install("eq_radar")).toBe(true);
    expect(lo.install("eq_radar")).toBe(true);
    expect(
      lo.installedGearIds().filter((id) => id === "eq_radar"),
    ).toHaveLength(1);
    expect(lo.derivedStats().categories.radar).toEqual({ used: 1, total: 1 });
  });
});
