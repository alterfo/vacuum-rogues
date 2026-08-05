import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  gearById,
  hullMicroModuleById,
  microModuleById,
  hullMicromoduleEffectKind,
  HULL_MICRO_MODULES,
  type HullSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import { micromoduleTargetCategory } from "@/systems/equipment/GearBridge";
import { ModuleCategory } from "@/types";

const ARMOR_1 = "mm_hull_armor_1"; // defense, tier 1 (+20%)
const HOLD_1 = "mm_hull_hold_1"; // cargo, tier 1 (+20%)
const PWR_WPN_1 = "mm_hull_pwr_wpn_1"; // energy → weapon, tier 1 (+20%)
const PWR_ENG_1 = "mm_hull_pwr_eng_1"; // energy → engine, tier 1 (+20%)

describe("HULL_MICRO_MODULES catalog", () => {
  it("is a distinct family targeting the hull, not the 4 gear categories", () => {
    expect(HULL_MICRO_MODULES.length).toBeGreaterThan(0);
    for (const mm of HULL_MICRO_MODULES) {
      expect(mm.targetCategory).toBe(ModuleCategory.HULL);
    }
  });

  it("covers defense, cargo and both energy-redirect effects", () => {
    const kinds = new Set(HULL_MICRO_MODULES.map((m) => m.bonusType));
    expect(kinds).toContain("defense");
    expect(kinds).toContain("cargo");
    expect(kinds).toContain("energyWeapon");
    expect(kinds).toContain("energyEngine");
  });

  it("has unique ids", () => {
    const ids = HULL_MICRO_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classifies each hull micromodule by the stat it boosts", () => {
    expect(hullMicromoduleEffectKind(ARMOR_1)).toBe("defense");
    expect(hullMicromoduleEffectKind(HOLD_1)).toBe("cargo");
    expect(hullMicromoduleEffectKind(PWR_WPN_1)).toBe("weapon");
    expect(hullMicromoduleEffectKind(PWR_ENG_1)).toBe("engine");
    expect(hullMicromoduleEffectKind("mm_amplifier_1")).toBe("defense");
    expect(hullMicromoduleEffectKind("does_not_exist")).toBe("defense");
  });
});

describe("micromoduleTargetCategory — hull vs gear modules", () => {
  it("returns HULL for a hull micromodule and the gear category for the rest", () => {
    expect(micromoduleTargetCategory(ARMOR_1)).toBe(ModuleCategory.HULL);
    expect(micromoduleTargetCategory(PWR_ENG_1)).toBe(ModuleCategory.HULL);
    expect(micromoduleTargetCategory("mm_wpn_1")).toBe(ModuleCategory.WEAPON);
    expect(micromoduleTargetCategory("mm_eng_1")).toBe(ModuleCategory.ENGINE);
    expect(micromoduleTargetCategory("nope")).toBeUndefined();
  });
});

describe("ShipLoadout — hull micromodule effects in derivedStats", () => {
  it("a defense hull micromodule boosts maxHull by the tier bonus, nothing else", () => {
    const hp = (gearById("hull_scout") as HullSpec).hp; // 90
    const cargo = (gearById("hull_scout") as HullSpec).cargo; // 20
    const lo = new ShipLoadout("hull_scout");
    expect(lo.derivedStats().maxHull).toBe(hp);

    expect(lo.applyMicromodule("hull_scout", ARMOR_1)).toBe(true);
    expect(lo.derivedStats().maxHull).toBe(Math.round(hp * 1.2));
    expect(lo.derivedStats().cargo).toBe(cargo);
  });

  it("a cargo hull micromodule boosts hold capacity, leaving maxHull untouched", () => {
    const hull = gearById("hull_scout") as HullSpec;
    const lo = new ShipLoadout("hull_scout");
    expect(lo.derivedStats().cargo).toBe(hull.cargo);

    expect(lo.applyMicromodule("hull_scout", HOLD_1)).toBe(true);
    expect(lo.derivedStats().cargo).toBe(Math.round(hull.cargo * 1.2));
    expect(lo.derivedStats().maxHull).toBe(hull.hp);
  });

  it("an energy→weapon hull micromodule raises total weapon damage", () => {
    const wpnDamage = (gearById("wpn_pulse") as WeaponSpec).damage; // 14
    const lo = new ShipLoadout("hull_warden");
    expect(lo.install("wpn_pulse")).toBe(true);
    expect(lo.derivedStats().weaponDamage).toBe(wpnDamage);

    expect(lo.applyMicromodule("hull_warden", PWR_WPN_1)).toBe(true);
    expect(lo.derivedStats().weaponDamage).toBe(Math.round(wpnDamage * 1.2));
    expect(lo.derivedStats().speed).toBe(0); // no engine installed
  });

  it("an energy→engine (engine-targeted) hull micromodule raises engine speed", () => {
    const lo = new ShipLoadout("hull_warden");
    expect(lo.install("eq_engine_i")).toBe(true); // tech 2 → 0.066 + 2*0.022 = 0.11
    const base = lo.derivedStats().speed;
    expect(base).toBeCloseTo(0.11, 3);

    expect(lo.applyMicromodule("hull_warden", PWR_ENG_1)).toBe(true);
    expect(lo.derivedStats().speed).toBeCloseTo(base * 1.2, 3);
    expect(lo.derivedStats().weaponDamage).toBe(0);
  });

  it("does not redirect energy when the targeted system is absent", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(lo.applyMicromodule("hull_scout", PWR_WPN_1)).toBe(true);
    expect(lo.derivedStats().weaponDamage).toBe(0);
    expect(lo.derivedStats().speed).toBe(0);
  });

  it("stacks four distinct hull effects independently on a 4-slot hull", () => {
    const hull = gearById("hull_bastion") as HullSpec; // hp 360, cargo 50, 4 slots
    const wpnDamage = (gearById("wpn_pulse") as WeaponSpec).damage; // 14
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.install("wpn_pulse")).toBe(true);
    expect(lo.install("eq_engine_i")).toBe(true);
    const baseSpeed = lo.derivedStats().speed;

    expect(lo.applyMicromodule("hull_bastion", ARMOR_1)).toBe(true);
    expect(lo.applyMicromodule("hull_bastion", HOLD_1)).toBe(true);
    expect(lo.applyMicromodule("hull_bastion", PWR_WPN_1)).toBe(true);
    expect(lo.applyMicromodule("hull_bastion", PWR_ENG_1)).toBe(true);

    const stats = lo.derivedStats();
    expect(stats.maxHull).toBe(Math.round(hull.hp * 1.2));
    expect(stats.cargo).toBe(Math.round(hull.cargo * 1.2));
    expect(stats.weaponDamage).toBe(Math.round(wpnDamage * 1.2));
    expect(stats.speed).toBeCloseTo(baseSpeed * 1.2, 3);
  });

  it("stacks same-effect hull micromodules multiplicatively", () => {
    const hull = gearById("hull_bastion") as HullSpec; // hp 360
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.applyMicromodule("hull_bastion", ARMOR_1)).toBe(true); // ×1.2
    expect(lo.applyMicromodule("hull_bastion", "mm_hull_armor_2")).toBe(true); // ×1.12
    expect(lo.derivedStats().maxHull).toBe(Math.round(hull.hp * 1.2 * 1.12));
  });

  it("round-trips hull-effect stats through toJSON/fromJSON", () => {
    const lo = new ShipLoadout("hull_bastion");
    lo.install("wpn_pulse");
    lo.install("eq_engine_i");
    lo.applyMicromodule("hull_bastion", HOLD_1);
    lo.applyMicromodule("hull_bastion", PWR_WPN_1);

    const restored = ShipLoadout.fromJSON(lo.toJSON());
    expect(restored).not.toBeNull();
    expect(restored!.derivedStats()).toEqual(lo.derivedStats());
  });

  it("lookup helper resolves a hull micromodule by id", () => {
    expect(hullMicroModuleById(ARMOR_1)?.bonusType).toBe("defense");
    expect(hullMicroModuleById("unknown")).toBeUndefined();
  });

  it("hull micromodule ids are not resolvable via the gear-only microModuleById", () => {
    for (const mm of HULL_MICRO_MODULES) {
      expect(microModuleById(mm.id)).toBeUndefined();
      expect(hullMicroModuleById(mm.id)?.name).toBe(mm.name);
    }
  });
});
