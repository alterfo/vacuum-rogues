import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";

const EQUIPMENT = GEAR_CATALOG.filter(
  (g): g is EquipmentSpec => g.kind === GearKind.EQUIPMENT,
);
const ENGINES = EQUIPMENT.filter(
  (g) => g.equipmentClass === EquipmentClass.ENGINE,
)
  .slice()
  .sort((a, b) => a.techLevel - b.techLevel);
const SHIELDS = EQUIPMENT.filter(
  (g) => g.equipmentClass === EquipmentClass.SHIELD,
)
  .slice()
  .sort((a, b) => a.techLevel - b.techLevel);

describe("engine ladder has no tech-tier dead zone (Task 17)", () => {
  it("every tech level from 2 through 6 has at least one engine", () => {
    const techLevels = new Set(ENGINES.map((e) => e.techLevel));
    for (let t = 2; t <= 6; t++) {
      expect(techLevels.has(t), `no engine at tech ${t}`).toBe(true);
    }
  });

  it("potency rises monotonically as engines get pricier, no gap T2 -> T6", () => {
    const byPrice = ENGINES.slice().sort((a, b) => a.basePrice - b.basePrice);
    for (let i = 1; i < byPrice.length; i++) {
      expect(
        byPrice[i].potency,
        `${byPrice[i].id} (${byPrice[i].potency}) should exceed cheaper ${byPrice[i - 1].id} (${byPrice[i - 1].potency})`,
      ).toBeGreaterThan(byPrice[i - 1].potency);
    }
  });

  it("eq_engine_ii and eq_engine_iib fill the 0.9 -> 1.4 potency dead-zone", () => {
    const ii = ENGINES.find((e) => e.id === "eq_engine_ii");
    const iib = ENGINES.find((e) => e.id === "eq_engine_iib");
    expect(ii).toBeDefined();
    expect(iib).toBeDefined();
    expect(ii!.potency).toBeGreaterThan(0.9);
    expect(ii!.potency).toBeLessThan(iib!.potency);
    expect(iib!.potency).toBeLessThan(1.4);
  });
});

describe("shield ladder fills the T4/T5/T7 gaps (Task 17)", () => {
  it("every tech level from 3 through 8 has at least one shield", () => {
    const techLevels = new Set(SHIELDS.map((s) => s.techLevel));
    for (let t = 3; t <= 8; t++) {
      expect(techLevels.has(t), `no shield at tech ${t}`).toBe(true);
    }
  });

  it("potency rises monotonically as shields get pricier", () => {
    const byPrice = SHIELDS.slice().sort((a, b) => a.basePrice - b.basePrice);
    for (let i = 1; i < byPrice.length; i++) {
      expect(
        byPrice[i].potency,
        `${byPrice[i].id} (${byPrice[i].potency}) should exceed cheaper ${byPrice[i - 1].id} (${byPrice[i - 1].potency})`,
      ).toBeGreaterThan(byPrice[i - 1].potency);
    }
  });
});

describe("new gear conforms to the catalog's structural shape", () => {
  const newIds = [
    "eq_engine_ii",
    "eq_engine_iib",
    "eq_shield_ii",
    "eq_shield_iii",
    "eq_shield_v",
  ];

  it("every new id is present exactly once in GEAR_CATALOG", () => {
    for (const id of newIds) {
      const matches = GEAR_CATALOG.filter((g) => g.id === id);
      expect(matches.length, id).toBe(1);
    }
  });

  it("every new item is a well-formed EquipmentSpec", () => {
    for (const id of newIds) {
      const g = EQUIPMENT.find((e) => e.id === id)!;
      expect(g, id).toBeDefined();
      expect(g.kind).toBe(GearKind.EQUIPMENT);
      expect(g.basePrice).toBeGreaterThan(0);
      expect(g.mass).toBeGreaterThan(0);
      expect(g.size).toBeGreaterThan(0);
      expect(g.potency).toBeGreaterThan(0);
      expect(g.techLevel).toBeGreaterThanOrEqual(1);
      expect(g.techLevel).toBeLessThanOrEqual(8);
      expect(g.rare).toBeUndefined();
      expect(g.minDay).toBeUndefined();
    }
  });
});
