import { describe, it, expect } from "vitest";
import { ShipLoadout, micromoduleBonus } from "@/systems/equipment/ShipLoadout";
import { gearById, WeaponSpec } from "@/systems/equipment/GearCatalog";

describe("ShipLoadout — fitting (US-073)", () => {
  it("rejects a non-hull as the chassis", () => {
    expect(() => new ShipLoadout("wpn_pulse")).toThrow();
    expect(() => new ShipLoadout("nope")).toThrow();
  });

  it("enforces per-category slot caps from the hull, not a flat total", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(lo.install("wpn_pulse")).toBe(true);
    expect(lo.install("wpn_railgun")).toBe(true);
    expect(lo.canInstall("wpn_scatter")).toBe(false);
    expect(lo.install("wpn_scatter")).toBe(false);
    expect(lo.install("eq_tank")).toBe(true);
    expect(lo.install("eq_scanner")).toBe(true);
    expect(lo.canInstall("eq_droid")).toBe(false);
    expect(lo.install("eq_droid")).toBe(false);
    const cats = lo.derivedStats().categories;
    expect(cats.weapon).toEqual({ used: 2, total: 2 });
    expect(cats.equipment).toEqual({ used: 2, total: 2 });
  });

  it("cannot install a hull as gear", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(lo.install("hull_warden")).toBe(false);
  });

  it("removes installed gear", () => {
    const lo = new ShipLoadout("hull_courier");
    lo.install("wpn_pulse");
    expect(lo.remove("wpn_pulse")).toBe(true);
    expect(lo.remove("wpn_pulse")).toBe(false); // already gone
  });

  it("derives ship stats from installed gear", () => {
    const lo = new ShipLoadout("hull_warden"); // hp 220, slots 7, cargo 35
    lo.install("eq_engine_iii"); // potency 1.4
    lo.install("eq_tank"); // fuel 40
    lo.install("wpn_beam"); // dmg 30
    lo.install("wpn_railgun"); // dmg 26
    lo.install("eq_radar"); // 1400
    lo.install("eq_shield"); // 80

    const s = lo.derivedStats();
    expect(s.maxHull).toBe(220);
    expect(s.cargo).toBe(35);
    expect(s.weaponCount).toBe(2);
    expect(s.weaponDamage).toBe(56); // 30 + 26
    expect(s.speed).toBeCloseTo(0.176);
    expect(s.radarRange).toBe(1400);
    expect(s.shields).toBe(180);
    expect(s.fuelCapacity).toBe(90);
    expect(s.canTakeOff).toBe(true); // engine + fuel
  });

  it("cannot take off without an engine or without a fuel tank (canon §11.4)", () => {
    const noEngine = new ShipLoadout("hull_scout");
    noEngine.install("eq_tank");
    expect(noEngine.derivedStats().canTakeOff).toBe(false);
    expect(noEngine.derivedStats().speed).toBe(0);

    const noFuel = new ShipLoadout("hull_scout");
    noFuel.install("eq_engine_i");
    expect(noFuel.derivedStats().canTakeOff).toBe(false);
  });

  it("keeps a single engine slot (a new engine replaces the old) and sums fuel tanks", () => {
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.install("eq_engine_i")).toBe(true); // tech 2 → 0.11 px/ms
    expect(lo.install("eq_engine_iii")).toBe(true); // tech 5 → 0.176 px/ms, replaces
    expect(
      lo.installedGearIds().filter((id) => id.startsWith("eq_engine")),
    ).toEqual(["eq_engine_iii"]);
    lo.install("eq_tank"); // 50 + 40 = 90
    lo.install("eq_tank"); // +90 → 180
    const s = lo.derivedStats();
    expect(s.speed).toBeCloseTo(0.176);
    expect(s.fuelCapacity).toBe(180);
    expect(s.categories.engine).toEqual({ used: 1, total: 1 });
  });
});

describe("ShipLoadout — micromodules (US-075)", () => {
  it("boosts an item's primary stat by the micromodule level", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_iii"); // needed so it can take off / move
    lo.install("eq_tank");
    lo.install("wpn_beam"); // base damage 30
    const base = lo.derivedStats().weaponDamage;

    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_1")).toBe(true);
    const boosted = lo.derivedStats().weaponDamage;
    const beamDmg = (gearById("wpn_beam") as WeaponSpec).damage;
    expect(boosted - base).toBe(Math.round(beamDmg * micromoduleBonus(1)));
  });

  it("allows only one micromodule per item and never removes it", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("wpn_beam");
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_2")).toBe(true);
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_1")).toBe(false);
  });

  it("can boost the hull's HP via a micromodule", () => {
    const lo = new ShipLoadout("hull_warden"); // hp 220
    expect(lo.applyMicromodule("hull_warden", "mm_amplifier_1")).toBe(true);
    expect(lo.derivedStats().maxHull).toBe(
      Math.round(220 * (1 + micromoduleBonus(1))),
    );
  });

  it("refuses to micromodule an item that isn't installed", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_1")).toBe(false);
  });
});

describe("ShipLoadout — persistence (toJSON/fromJSON)", () => {
  it("round-trips hull, gear and micromodules through a snapshot", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("wpn_beam");
    lo.install("eq_engine_iii");
    lo.install("eq_tank");
    lo.applyMicromodule("wpn_beam", "mm_amplifier_2");
    lo.applyMicromodule("hull_warden", "mm_amplifier_1");

    const restored = ShipLoadout.fromJSON(lo.toJSON());
    expect(restored).not.toBeNull();
    expect(restored!.hull.id).toBe("hull_warden");
    expect(restored!.installedGearIds()).toEqual([
      "wpn_beam",
      "eq_engine_iii",
      "eq_tank",
    ]);
    expect(restored!.derivedStats()).toEqual(lo.derivedStats());
  });

  it("survives JSON.stringify/parse (the actual save payload path)", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    const snapshot = JSON.parse(JSON.stringify(lo.toJSON()));
    const restored = ShipLoadout.fromJSON(snapshot);
    expect(restored!.derivedStats()).toEqual(lo.derivedStats());
  });

  it("returns null for an unknown hull id", () => {
    expect(
      ShipLoadout.fromJSON({ hullId: "hull_gone", slotted: [] }),
    ).toBeNull();
  });

  it("restores micromodules per slot when the same gear is installed twice", () => {
    const restored = ShipLoadout.fromJSON({
      hullId: "hull_bastion",
      slotted: [
        { gearId: "eq_shield", micromoduleId: "mm_amplifier_1" },
        { gearId: "eq_shield", micromoduleId: "mm_amplifier_2" },
      ],
    });
    expect(restored).not.toBeNull();
    const expected =
      Math.round(180 * (1 + micromoduleBonus(1))) +
      Math.round(180 * (1 + micromoduleBonus(2)));
    expect(restored!.derivedStats().shields).toBe(expected);
    expect(restored!.toJSON().slotted).toEqual([
      { gearId: "eq_shield", micromoduleId: "mm_amplifier_1" },
      { gearId: "eq_shield", micromoduleId: "mm_amplifier_2" },
    ]);
  });

  it("restores an over-cap saved fitting as-is (no auto-eviction on load)", () => {
    const restored = ShipLoadout.fromJSON({
      hullId: "hull_corvette", // weaponSlots 2
      slotted: [
        { gearId: "wpn_pulse" },
        { gearId: "wpn_beam" },
        { gearId: "wpn_railgun" },
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
      ],
    });
    expect(restored).not.toBeNull();
    expect(restored!.installedGearIds()).toEqual([
      "wpn_pulse",
      "wpn_beam",
      "wpn_railgun",
      "eq_engine_i",
      "eq_tank",
    ]);
    expect(restored!.derivedStats().categories.weapon).toEqual({
      used: 3,
      total: 2,
    });
  });

  it("skips unknown gear/micromodule ids without voiding the loadout", () => {
    const restored = ShipLoadout.fromJSON({
      hullId: "hull_corvette",
      hullMicromoduleId: "mm_gone",
      slotted: [
        { gearId: "eq_gone" },
        { gearId: "eq_engine_i", micromoduleId: "mm_gone" },
      ],
    });
    expect(restored).not.toBeNull();
    expect(restored!.installedGearIds()).toEqual(["eq_engine_i"]);
    expect(restored!.derivedStats().canTakeOff).toBe(false); // no fuel tank
  });
});
