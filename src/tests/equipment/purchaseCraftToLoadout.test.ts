import { describe, it, expect } from "vitest";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import {
  ShipLoadout,
  micromoduleBonus,
  micromoduleById,
} from "@/systems/equipment/ShipLoadout";
import {
  gearById,
  GearKind,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import { gearMicromoduleCategory } from "@/systems/equipment/GearBridge";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { ModuleCategory } from "@/types";

/**
 * Dual-hull Task 3: gear purchases and crafted micromodules must land in the
 * canonical ShipLoadout, not the legacy `ship.modules`/`inventory.modules`
 * representation. These tests pin the two seams the shop & hangar scenes drive
 * — EquipmentSystem.installGear (purchase → loadout) and
 * ShipLoadout.applyMicromodule via the GearCatalog-bridged micromoduleById
 * (craft → loadout) — so the UI code that calls them is exercised without a
 * PixiJS scene.
 */

describe("EquipmentSystem.installGear — purchases land in the loadout", () => {
  it("installs a purchased weapon into a free loadout slot", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");
    const before = loadout.installedGearIds().length;

    expect(eq.installGear(loadout, "wpn_pulse")).toBe(true);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    expect(loadout.installedGearIds().length).toBe(before + 1);
  });

  it("installs purchased equipment into a free loadout slot", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installGear(loadout, "eq_radar")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_radar");
  });

  it("rejects a hull id (hulls are swapped via setHull, not installed)", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installGear(loadout, "hull_scout")).toBe(false);
    expect(loadout.installedGearIds()).not.toContain("hull_scout");
  });

  it("rejects an unknown gear id", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installGear(loadout, "not_a_real_id")).toBe(false);
  });

  it("returns false (never replaces fitted gear) when the loadout is full", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");
    const slots = loadout.hull.slots;
    // Fill every bank in a valid SR-canon mix: 2 weapons + engine + radar +
    // 1 additional equipment fills the corvette's 5 slots, weapon bank included.
    const fill = [
      "wpn_pulse",
      "wpn_pulse",
      "eq_engine_i",
      "eq_radar",
      "eq_tank",
    ];
    for (const id of fill) {
      expect(loadout.install(id)).toBe(true);
    }

    // Weapon bank is full → a purchased weapon cannot be force-installed.
    expect(eq.installGear(loadout, "wpn_railgun")).toBe(false);
    expect(loadout.installedGearIds().length).toBe(slots);
  });

  it("a real shop listing's non-hull gear is installable via the loadout", () => {
    const eq = new EquipmentSystem();
    const listings = generateShop({
      systemId: "system_1",
      planetId: "planet_industrial",
      seed: "TASK3_SEED",
      day: 14,
    });
    const nonHull = listings.find((l) => l.gear.kind !== GearKind.HULL);
    expect(nonHull).toBeDefined();

    const loadout = new ShipLoadout("hull_corvette");
    expect(eq.installGear(loadout, nonHull!.gear.id)).toBe(true);
    expect(loadout.installedGearIds()).toContain(nonHull!.gear.id);
  });
});

describe("gearMicromoduleCategory — match a micromodule to fitted gear", () => {
  it("maps gear kinds/classes onto micromodule categories", () => {
    expect(gearMicromoduleCategory(gearById("wpn_beam")!)).toBe(
      ModuleCategory.WEAPON,
    );
    expect(gearMicromoduleCategory(gearById("eq_engine_i")!)).toBe(
      ModuleCategory.ENGINE,
    );
    expect(gearMicromoduleCategory(gearById("eq_shield")!)).toBe(
      ModuleCategory.SHIELD,
    );
    expect(gearMicromoduleCategory(gearById("eq_radar")!)).toBe(
      ModuleCategory.EQUIPMENT,
    );
    expect(gearMicromoduleCategory(gearById("hull_corvette")!)).toBeNull();
  });
});

describe("Crafted micromodules apply to the loadout (bridged catalog)", () => {
  it("micromoduleById resolves a CRAFT_CENTER micromodule id", () => {
    const mm = micromoduleById("mm_wpn_1");
    expect(mm).toBeDefined();
    expect(mm!.level).toBe(1); // bonusTier 1 maps onto level 1
  });

  it("applying a crafted weapon micromodule boosts weapon damage", () => {
    const beam = gearById("wpn_beam") as WeaponSpec;
    const lo = new ShipLoadout("hull_corvette");
    lo.install("wpn_beam");
    const base = lo.derivedStats().weaponDamage;

    expect(lo.applyMicromodule("wpn_beam", "mm_wpn_1")).toBe(true);

    const boosted = lo.derivedStats().weaponDamage;
    expect(boosted - base).toBe(Math.round(beam.damage * micromoduleBonus(1)));
  });

  it("applying a crafted engine micromodule boosts derived speed", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    const base = lo.derivedStats().speed;

    expect(lo.applyMicromodule("eq_engine_i", "mm_eng_1")).toBe(true);

    expect(lo.derivedStats().speed).toBeCloseTo(base * 1.2, 3);
  });

  it("still allows only one micromodule per item", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("wpn_beam");
    expect(lo.applyMicromodule("wpn_beam", "mm_wpn_1")).toBe(true);
    expect(lo.applyMicromodule("wpn_beam", "mm_wpn_2")).toBe(false);
  });
});
