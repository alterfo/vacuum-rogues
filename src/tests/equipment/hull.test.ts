import { describe, it, expect } from "vitest";
import { HullClass, HULL_CLASS_SPECS } from "@/types";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  GEAR_CATALOG,
  GearKind,
  gearById,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";

describe("HullClass specs — slot counts", () => {
  it("LIGHT_FIGHTER has 2 weapon slots, 2 equipment slots, cargo 20", () => {
    const s = HULL_CLASS_SPECS[HullClass.LIGHT_FIGHTER];
    expect(s.weaponSlots).toBe(2);
    expect(s.equipmentSlots).toBe(2);
    expect(s.cargoCapacity).toBe(20);
  });

  it("CORVETTE has 2 weapon slots, 3 equipment slots, cargo 30", () => {
    const s = HULL_CLASS_SPECS[HullClass.CORVETTE];
    expect(s.weaponSlots).toBe(2);
    expect(s.equipmentSlots).toBe(3);
    expect(s.cargoCapacity).toBe(30);
  });

  it("TRANSPORT has fewer weapon slots and more cargo than CORVETTE", () => {
    const transport = HULL_CLASS_SPECS[HullClass.TRANSPORT];
    const corvette = HULL_CLASS_SPECS[HullClass.CORVETTE];
    expect(transport.weaponSlots).toBeLessThanOrEqual(corvette.weaponSlots);
    expect(transport.cargoCapacity).toBeGreaterThan(corvette.cargoCapacity);
  });

  it("DESTROYER has the highest maxHp", () => {
    const destroyer = HULL_CLASS_SPECS[HullClass.DESTROYER];
    for (const cls of Object.values(HullClass)) {
      if (cls === HullClass.DESTROYER) continue;
      expect(destroyer.maxHp).toBeGreaterThanOrEqual(
        HULL_CLASS_SPECS[cls].maxHp,
      );
    }
  });

  it("HEAVY_FREIGHTER has the highest cargo capacity", () => {
    const freighter = HULL_CLASS_SPECS[HullClass.HEAVY_FREIGHTER];
    for (const cls of Object.values(HullClass)) {
      if (cls === HullClass.HEAVY_FREIGHTER) continue;
      expect(freighter.cargoCapacity).toBeGreaterThanOrEqual(
        HULL_CLASS_SPECS[cls].cargoCapacity,
      );
    }
  });

  it("all 6 hull classes are defined", () => {
    const classes = Object.values(HullClass);
    expect(classes).toHaveLength(6);
    for (const cls of classes) {
      expect(HULL_CLASS_SPECS[cls]).toBeDefined();
      expect(HULL_CLASS_SPECS[cls].maxHp).toBeGreaterThan(0);
    }
  });
});

// ⚠️ dual-hull Task 5: the legacy "PlayerShip derived getters" describe (which
// asserted ship.weaponSlots/equipmentSlots/cargoCapacity off HULL_CLASS_SPECS)
// was retired with those getters. Derived hull stats are now read from the
// canonical ShipLoadout — these are its loadout-based replacements.
describe("ShipLoadout — derived hull stats (replaces PlayerShip getters)", () => {
  const HULL_IDS = GEAR_CATALOG.filter(
    (g): g is HullSpec => g.kind === GearKind.HULL,
  ).map((h) => h.id);

  it("derivedStats cargo + slot totals match the installed hull spec", () => {
    for (const hullId of HULL_IDS) {
      const loadout = new ShipLoadout(hullId);
      const hull = loadout.hull;
      const stats = loadout.derivedStats();
      expect(stats.cargo).toBe(hull.cargo);
      expect(stats.slotsTotal).toBe(hull.slots);
    }
  });

  it("a roomier hull derives a bigger hold than the corvette", () => {
    const corvette = new ShipLoadout("hull_corvette");
    const freighter = new ShipLoadout("hull_freighter");
    expect(freighter.derivedStats().cargo).toBeGreaterThan(
      corvette.derivedStats().cargo,
    );
  });
});

// ⚠️ dual-hull Task 5: the legacy "Hull buying — modules move to inventory"
// describe (ship.modules[] mutation) was retired with the modules array. The
// canonical hull swap is ShipLoadout.setHull, which drops gear that no longer
// fits — this is its loadout-based replacement.
describe("ShipLoadout.setHull — hull swap (replaces legacy module shuffle)", () => {
  it("swaps the hull and drops slotted gear that no longer fits", () => {
    const loadout = new ShipLoadout("hull_bastion"); // most slots
    const slots = loadout.hull.slots;
    // Fill every bank in a valid SR-canon mix totalling the hull's 9 slots:
    // 4 weapons + engine + radar + 3 additional-equipment items. (A single
    // category can no longer flat-fill — engine/radar are dedicated 1-slots.)
    for (let i = 0; i < 4; i++) loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");
    loadout.install("eq_radar");
    loadout.install("eq_tank");
    loadout.install("eq_scanner");
    loadout.install("eq_droid");
    expect(loadout.installedSlots()).toHaveLength(slots);

    loadout.setHull("hull_scout"); // fewest slots
    expect(loadout.hull.hullClass).toBe(HullClass.LIGHT_FIGHTER);
    expect(loadout.installedSlots().length).toBeLessThanOrEqual(
      loadout.hull.slots,
    );
  });
});

describe("GearCatalog hull entries", () => {
  it("hull_corvette exists and has CORVETTE class", () => {
    const g = gearById("hull_corvette");
    expect(g).toBeDefined();
    expect(g?.kind).toBe(GearKind.HULL);
    expect((g as HullSpec).hullClass).toBe(HullClass.CORVETTE);
  });

  it("all 6 hull classes are represented in the catalog", () => {
    const hullClasses = GEAR_CATALOG.filter(
      (g): g is HullSpec => g.kind === GearKind.HULL,
    ).map((h) => h.hullClass);
    for (const cls of Object.values(HullClass)) {
      expect(hullClasses).toContain(cls);
    }
  });

  it("hull spec weaponSlots + equipmentSlots equals slots", () => {
    const hulls = GEAR_CATALOG.filter(
      (g): g is HullSpec => g.kind === GearKind.HULL,
    );
    for (const hull of hulls) {
      expect(hull.weaponSlots + hull.equipmentSlots).toBe(hull.slots);
    }
  });
});
