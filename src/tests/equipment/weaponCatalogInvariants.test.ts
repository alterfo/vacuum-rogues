import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  WeaponClass,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";

/**
 * Gear variety expansion (Task 3): the weapon ladder must fill out with real
 * (non-clone) tiers across T1–T8 and every WeaponClass before the hangar ring
 * rework lands. Pins the shape of the catalog, not exact numbers, so later
 * tuning doesn't churn this file.
 */

const WEAPONS = GEAR_CATALOG.filter(
  (g): g is WeaponSpec => g.kind === GearKind.WEAPON,
);

describe("Weapon catalog invariants (Task 3)", () => {
  it("has at least 12 weapons total", () => {
    expect(WEAPONS.length).toBeGreaterThanOrEqual(12);
  });

  it("every WeaponClass has at least 3 catalog items", () => {
    for (const cls of Object.values(WeaponClass)) {
      const count = WEAPONS.filter((w) => w.weaponClass === cls).length;
      expect(
        count,
        `${cls} has only ${count} items — needs ≥3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("the ladder spans from low tech (≤2) to the top tier (≥7)", () => {
    const minTech = Math.min(...WEAPONS.map((w) => w.techLevel));
    const maxTech = Math.max(...WEAPONS.map((w) => w.techLevel));
    expect(minTech).toBeLessThanOrEqual(2);
    expect(maxTech).toBeGreaterThanOrEqual(7);
  });

  it("no two weapons are exact clones (damage/range/cooldownTurns/ability)", () => {
    const signatures = WEAPONS.map(
      (w) => `${w.damage}|${w.range}|${w.cooldownTurns}|${w.ability}`,
    );
    expect(new Set(signatures).size).toBe(WEAPONS.length);
  });

  it("every weapon differs from same-class peers on at least 2 stat axes", () => {
    for (const cls of Object.values(WeaponClass)) {
      const items = WEAPONS.filter((w) => w.weaponClass === cls);
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const axes = [
            a.damage !== b.damage,
            a.range !== b.range,
            a.cooldownTurns !== b.cooldownTurns,
            a.mass !== b.mass,
            a.ability !== b.ability,
          ];
          const diffCount = axes.filter(Boolean).length;
          expect(
            diffCount,
            `${a.id} vs ${b.id} differ on only ${diffCount} axis/axes`,
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});
