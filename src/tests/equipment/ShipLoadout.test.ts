import { describe, it, expect } from "vitest";
import { ShipLoadout, micromoduleBonus } from "@/systems/equipment/ShipLoadout";
import { gearById, WeaponSpec } from "@/systems/equipment/GearCatalog";

describe("ShipLoadout — fitting (US-073)", () => {
  it("rejects a non-hull as the chassis", () => {
    expect(() => new ShipLoadout("wpn_pulse")).toThrow();
    expect(() => new ShipLoadout("nope")).toThrow();
  });

  it("installs gear up to the hull's slot count, then refuses", () => {
    const lo = new ShipLoadout("hull_scout"); // 4 slots
    expect(lo.install("wpn_pulse")).toBe(true);
    expect(lo.install("eq_engine_i")).toBe(true);
    expect(lo.install("eq_tank")).toBe(true);
    expect(lo.install("eq_radar")).toBe(true);
    expect(lo.derivedStats().slotsUsed).toBe(4);
    // 5th item — no free slot.
    expect(lo.canInstall("eq_scanner")).toBe(false);
    expect(lo.install("eq_scanner")).toBe(false);
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
    expect(s.speed).toBeCloseTo(1.4);
    expect(s.radarRange).toBe(1400);
    expect(s.shields).toBe(80);
    expect(s.fuelCapacity).toBe(40);
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

  it("uses the strongest engine and sums fuel tanks", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("eq_engine_i"); // 0.9
    lo.install("eq_engine_iii"); // 1.4 → should win
    lo.install("eq_tank"); // 40
    lo.install("eq_tank"); // +40 → 80
    const s = lo.derivedStats();
    expect(s.speed).toBeCloseTo(1.4);
    expect(s.fuelCapacity).toBe(80);
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
    // Only the beam is boosted by the level-1 (+20%) bonus.
    expect(boosted - base).toBe(Math.round(beamDmg * micromoduleBonus(1)));
  });

  it("allows only one micromodule per item and never removes it", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("wpn_beam");
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_2")).toBe(true);
    // Second attempt on the same item is refused (one per item, no replace).
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
