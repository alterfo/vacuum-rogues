import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  isRareGear,
  slotCategoryFor,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";

/**
 * Gear variety expansion (Task 2): the catalog must fill out every equipment
 * family with ≥3 real (non-clone) tiers before the hangar ring rework lands.
 * These invariants pin the shape of the catalog, not exact numbers, so later
 * tuning doesn't churn this file.
 */

const EQUIPMENT = GEAR_CATALOG.filter(
  (g): g is EquipmentSpec => g.kind === GearKind.EQUIPMENT,
);
const HULLS = GEAR_CATALOG.filter((g) => g.kind === GearKind.HULL);
const ENGINES = EQUIPMENT.filter(
  (g) => g.equipmentClass === EquipmentClass.ENGINE,
);
const TANKS = EQUIPMENT.filter(
  (g) => g.equipmentClass === EquipmentClass.FUEL_TANK,
);
const WEAPONS = GEAR_CATALOG.filter((g) => g.kind === GearKind.WEAPON);

describe("GearCatalog invariants (Task 2)", () => {
  it("every gear id is unique", () => {
    const ids = GEAR_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every EquipmentClass has at least 3 catalog items", () => {
    for (const cls of Object.values(EquipmentClass)) {
      const count = EQUIPMENT.filter((g) => g.equipmentClass === cls).length;
      expect(
        count,
        `${cls} has only ${count} items — needs ≥3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("the GRAPPLE family exists with real catalog items", () => {
    expect(ENGINES.length).toBeGreaterThanOrEqual(3); // sanity: filter works
    const grapples = EQUIPMENT.filter(
      (g) => g.equipmentClass === EquipmentClass.GRAPPLE,
    );
    expect(grapples.length).toBeGreaterThanOrEqual(3);
    for (const g of grapples) {
      expect(g.potency, g.id).toBeGreaterThan(0);
    }
  });

  it("within each equipment family, the top tech tier costs and weighs more than the entry tier", () => {
    for (const cls of Object.values(EquipmentClass)) {
      const items = EQUIPMENT.filter((g) => g.equipmentClass === cls);
      if (items.length < 2) continue;
      const lowest = items.reduce((a, b) =>
        a.techLevel <= b.techLevel ? a : b,
      );
      const highest = items.reduce((a, b) =>
        a.techLevel >= b.techLevel ? a : b,
      );
      expect(
        highest.basePrice,
        `${cls}: ${highest.id} (top tier) should cost more than ${lowest.id} (entry tier)`,
      ).toBeGreaterThan(lowest.basePrice);
      expect(
        highest.mass,
        `${cls}: ${highest.id} (top tier) should weigh at least as much as ${lowest.id}`,
      ).toBeGreaterThanOrEqual(lowest.mass);
    }
  });

  it("no two items within a family are exact clones (price/mass/potency)", () => {
    for (const cls of Object.values(EquipmentClass)) {
      const items = EQUIPMENT.filter((g) => g.equipmentClass === cls);
      const signatures = items.map(
        (g) => `${g.basePrice}|${g.mass}|${g.potency}`,
      );
      expect(new Set(signatures).size, cls).toBe(items.length);
    }
  });

  it("every non-hull item's slotCategoryFor resolves", () => {
    for (const g of GEAR_CATALOG) {
      if (g.kind === GearKind.HULL) continue;
      expect(slotCategoryFor(g), g.id).toBeDefined();
    }
  });

  it("rare-flagged/implied gear is T5+", () => {
    for (const g of GEAR_CATALOG.filter(isRareGear)) {
      expect(g.techLevel, g.id).toBeGreaterThanOrEqual(5);
    }
  });

  it("every hull admits a basic same-tech engine+tank+weapon kit within its mass budget", () => {
    for (const hull of HULLS) {
      const affordable = <T extends { techLevel: number; mass: number }>(
        items: T[],
      ) => items.filter((i) => i.techLevel <= hull.techLevel);
      const lightestOf = <T extends { mass: number }>(items: T[]) =>
        items.slice().sort((a, b) => a.mass - b.mass)[0];

      const engine = lightestOf(affordable(ENGINES));
      const tank = lightestOf(affordable(TANKS));
      const weapon = lightestOf(affordable(WEAPONS));
      expect(engine, hull.id).toBeDefined();
      expect(tank, hull.id).toBeDefined();
      expect(weapon, hull.id).toBeDefined();

      const totalMass = engine.mass + tank.mass + weapon.mass;
      expect(
        totalMass,
        `${hull.id} cannot fit a basic same-tech kit (${totalMass} > ${hull.massCapacity})`,
      ).toBeLessThanOrEqual(hull.massCapacity);
    }
  });
});
