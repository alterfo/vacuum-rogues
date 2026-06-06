import { describe, it, expect } from "vitest";
import {
  HullClass,
  HULL_CLASS_SPECS,
  FactionType,
  ModuleCategory,
} from "@/types";
import { PlayerShip } from "@/domain/PlayerShip";
import { ShipModule } from "@/domain/ShipModule";
import { Inventory } from "@/domain/Inventory";
import {
  GEAR_CATALOG,
  GearKind,
  gearById,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";

function makeShip(hullClass: HullClass = HullClass.CORVETTE): PlayerShip {
  const spec = HULL_CLASS_SPECS[hullClass];
  return new PlayerShip(
    "ship1",
    "Test Ship",
    spec.maxHp,
    spec.maxHp,
    50,
    50,
    100,
    100,
    1.0,
    0.8,
    FactionType.PROGRESSORS,
    hullClass,
  );
}

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

describe("PlayerShip derived getters", () => {
  it("weaponSlots matches HULL_CLASS_SPECS for FRIGATE", () => {
    const ship = makeShip(HullClass.FRIGATE);
    expect(ship.weaponSlots).toBe(
      HULL_CLASS_SPECS[HullClass.FRIGATE].weaponSlots,
    );
  });

  it("equipmentSlots matches HULL_CLASS_SPECS for TRANSPORT", () => {
    const ship = makeShip(HullClass.TRANSPORT);
    expect(ship.equipmentSlots).toBe(
      HULL_CLASS_SPECS[HullClass.TRANSPORT].equipmentSlots,
    );
  });

  it("cargoCapacity matches HULL_CLASS_SPECS for HEAVY_FREIGHTER", () => {
    const ship = makeShip(HullClass.HEAVY_FREIGHTER);
    expect(ship.cargoCapacity).toBe(
      HULL_CLASS_SPECS[HullClass.HEAVY_FREIGHTER].cargoCapacity,
    );
  });

  it("defaults to CORVETTE when no hullClass provided", () => {
    const ship = new PlayerShip(
      "s",
      "Ship",
      100,
      100,
      50,
      50,
      100,
      100,
      1,
      0.8,
      FactionType.OUTLANDERS,
    );
    expect(ship.hullClass).toBe(HullClass.CORVETTE);
    expect(ship.weaponSlots).toBe(
      HULL_CLASS_SPECS[HullClass.CORVETTE].weaponSlots,
    );
  });
});

describe("Hull buying — modules move to inventory", () => {
  it("buying a hull uninstalls all ship modules to inventory", () => {
    const ship = makeShip(HullClass.CORVETTE);
    const mod1 = new ShipModule(
      "eq1",
      ModuleCategory.ENGINE,
      "Engine",
      { type: "engine", value: 10 },
      2,
    );
    const mod2 = new ShipModule(
      "eq2",
      ModuleCategory.SHIELD,
      "Shield",
      { type: "shield", value: 5 },
      3,
    );
    ship.modules[0] = mod1;
    ship.modules[1] = mod2;

    const inventory = new Inventory();

    for (const mod of ship.modules) {
      if (mod !== null) {
        inventory.addItem(mod);
      }
    }
    ship.modules = [null, null, null];

    const newSpec = HULL_CLASS_SPECS[HullClass.DESTROYER];
    ship.hullClass = HullClass.DESTROYER;
    ship.maxHull = newSpec.maxHp;
    ship.hullHP = Math.min(ship.hullHP, newSpec.maxHp);

    expect(inventory.modules).toHaveLength(2);
    expect(inventory.modules[0].id).toBe("eq1");
    expect(inventory.modules[1].id).toBe("eq2");
    expect(ship.modules).toEqual([null, null, null]);
    expect(ship.hullClass).toBe(HullClass.DESTROYER);
    expect(ship.maxHull).toBe(newSpec.maxHp);
  });

  it("hullHP is clamped to new maxHull when downgrading hull", () => {
    const ship = makeShip(HullClass.DESTROYER);
    ship.hullHP = 350;
    ship.modules = [null, null, null];

    const newSpec = HULL_CLASS_SPECS[HullClass.LIGHT_FIGHTER];
    ship.hullClass = HullClass.LIGHT_FIGHTER;
    ship.maxHull = newSpec.maxHp;
    ship.hullHP = Math.min(ship.hullHP, newSpec.maxHp);

    expect(ship.hullHP).toBeLessThanOrEqual(ship.maxHull);
    expect(ship.hullHP).toBe(newSpec.maxHp);
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
