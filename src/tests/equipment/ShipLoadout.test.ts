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
    // eq_engine_iii: tech 5 → 0.05 + 5*0.03 = 0.20 px/ms
    expect(s.speed).toBeCloseTo(0.2);
    // eq_radar: tech 4 → 600 + 4*200 = 1400 px
    expect(s.radarRange).toBe(1400);
    // eq_shield: tech 6 → 6*30 = 180 HP
    expect(s.shields).toBe(180);
    // eq_tank: 50 base + 40 potency = 90 units
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

  it("uses the strongest engine and sums fuel tanks", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("eq_engine_i"); // tech 2 → 0.05 + 0.06 = 0.11 px/ms
    lo.install("eq_engine_iii"); // tech 5 → 0.05 + 0.15 = 0.20 px/ms → wins
    lo.install("eq_tank"); // 50 + 40 = 90
    lo.install("eq_tank"); // +90 → 180
    const s = lo.derivedStats();
    expect(s.speed).toBeCloseTo(0.2);
    expect(s.fuelCapacity).toBe(180);
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
    // Derived stats (which fold in both micromodules) must match exactly.
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
