import { describe, it, expect } from "vitest";
import { WeaponClass } from "@/systems/equipment/GearCatalog";
import {
  DEFAULT_WEAPON_VFX,
  WeaponVfxKind,
  isDistortionTier,
  missileTrailPoints,
  selectWeaponVfx,
  weaponVfxKind,
  type WeaponVfxInput,
} from "@/presentation/flight/combatWeaponVfx";
import { WEAPON_VFX } from "@/config/balance";

function weapon(over: Partial<WeaponVfxInput> = {}): WeaponVfxInput {
  return { weaponClass: WeaponClass.ENERGY, techLevel: 2, ...over };
}

describe("WEAPON_VFX config parity (single source of truth)", () => {
  it("balance.ts WEAPON_VFX mirrors the module default", () => {
    expect(DEFAULT_WEAPON_VFX).toEqual({
      distortionMinTech: WEAPON_VFX.distortionMinTech,
    });
  });
});

describe("weaponVfxKind — base style per WeaponClass (Task 13 dispatch)", () => {
  it("ENERGY → BEAM (continuous laser)", () => {
    expect(weaponVfxKind(WeaponClass.ENERGY)).toBe(WeaponVfxKind.BEAM);
  });
  it("FRAGMENT → BURST (plasma blaster)", () => {
    expect(weaponVfxKind(WeaponClass.FRAGMENT)).toBe(WeaponVfxKind.BURST);
  });
  it("MISSILE → MISSILE_TRAIL (smoke-trail arc)", () => {
    expect(weaponVfxKind(WeaponClass.MISSILE)).toBe(
      WeaponVfxKind.MISSILE_TRAIL,
    );
  });
});

describe("isDistortionTier — heaviest-tier threshold (Task 13 decision)", () => {
  it("a rare weapon of any tech qualifies", () => {
    expect(isDistortionTier(weapon({ techLevel: 1, rare: true }))).toBe(true);
    expect(isDistortionTier(weapon({ techLevel: 6, rare: true }))).toBe(true);
  });

  it("a non-rare weapon at/above distortionMinTech qualifies", () => {
    expect(isDistortionTier(weapon({ techLevel: 7 }))).toBe(true);
    expect(isDistortionTier(weapon({ techLevel: 8 }))).toBe(true);
  });

  it("a non-rare weapon below distortionMinTech does not", () => {
    expect(isDistortionTier(weapon({ techLevel: 6 }))).toBe(false);
    expect(isDistortionTier(weapon({ techLevel: 2 }))).toBe(false);
  });

  it("respects a custom threshold config", () => {
    expect(
      isDistortionTier(weapon({ techLevel: 5 }), { distortionMinTech: 5 }),
    ).toBe(true);
    expect(
      isDistortionTier(weapon({ techLevel: 4 }), { distortionMinTech: 5 }),
    ).toBe(false);
  });
});

describe("selectWeaponVfx — full variant dispatch", () => {
  it("energy laser → BEAM, no distortion at low tech", () => {
    expect(
      selectWeaponVfx(
        weapon({ weaponClass: WeaponClass.ENERGY, techLevel: 2 }),
      ),
    ).toEqual({ kind: WeaponVfxKind.BEAM, distortion: false });
  });

  it("fragment blaster → BURST", () => {
    expect(
      selectWeaponVfx(
        weapon({ weaponClass: WeaponClass.FRAGMENT, techLevel: 3 }),
      ).kind,
    ).toBe(WeaponVfxKind.BURST);
  });

  it("missile → MISSILE_TRAIL", () => {
    expect(
      selectWeaponVfx(
        weapon({ weaponClass: WeaponClass.MISSILE, techLevel: 3 }),
      ).kind,
    ).toBe(WeaponVfxKind.MISSILE_TRAIL);
  });

  it("a rare apex missile keeps its base kind AND gets distortion", () => {
    // Mirrors catalog wpn_singularity_lance (MISSILE, T8, rare).
    expect(
      selectWeaponVfx({
        weaponClass: WeaponClass.MISSILE,
        techLevel: 8,
        rare: true,
      }),
    ).toEqual({ kind: WeaponVfxKind.MISSILE_TRAIL, distortion: true });
  });

  it("a high-tech non-rare energy weapon gets distortion (wpn_disruptor T7)", () => {
    expect(
      selectWeaponVfx({ weaponClass: WeaponClass.ENERGY, techLevel: 7 }),
    ).toEqual({ kind: WeaponVfxKind.BEAM, distortion: true });
  });
});

describe("missileTrailPoints — trail tracks the flown path (Task 7 tie-in)", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
    { x: 30, y: 12 },
  ];

  it("returns a copy of the whole path when under the cap", () => {
    const out = missileTrailPoints(path, 12);
    expect(out).toEqual(path);
    expect(out).not.toBe(path); // fresh array, not the input
    expect(out[0]).not.toBe(path[0]); // fresh point objects
  });

  it("keeps only the most-recent points past the cap", () => {
    const out = missileTrailPoints(path, 2);
    expect(out).toEqual([
      { x: 20, y: 5 },
      { x: 30, y: 12 },
    ]);
  });

  it("never mutates the input path", () => {
    const before = JSON.parse(JSON.stringify(path));
    missileTrailPoints(path, 2);
    expect(path).toEqual(before);
  });

  it("clamps a tiny/invalid cap to at least 2", () => {
    expect(missileTrailPoints(path, 0)).toHaveLength(2);
    expect(missileTrailPoints(path, 1)).toHaveLength(2);
  });
});
