import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

describe("ShipLoadout.derivedStats — tech-based formulas (Task 6)", () => {
  it("engine speed = 0.066 + techLevel × 0.022 px/ms", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i"); // tech 2
    lo.install("eq_tank");
    const s = lo.derivedStats();
    expect(s.speed).toBeCloseTo(0.11, 3);
  });

  it("higher-tech engine wins when both installed", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("eq_engine_i"); // tech 2 → 0.11
    lo.install("eq_engine_iii"); // tech 5 → 0.176 → wins
    lo.install("eq_tank");
    expect(lo.derivedStats().speed).toBeCloseTo(0.176, 3);
  });

  it("fuel capacity = 50 base + potency per tank, summed", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    lo.install("eq_tank"); // 50 + 40 = 90
    lo.install("eq_tank"); // another 90 → 180
    const s = lo.derivedStats();
    expect(s.fuelCapacity).toBe(180);
  });

  it("radar range = 600 + techLevel × 200 px", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_radar"); // tech 4 → 600 + 800 = 1400
    expect(lo.derivedStats().radarRange).toBe(1400);
  });

  it("shield HP = techLevel × 30 per shield module", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_shield"); // tech 6 → 6*30 = 180
    expect(lo.derivedStats().shields).toBe(180);
  });

  it("droid repair rate = 1 + techLevel × 0.5 HP/day", () => {
    const lo = new ShipLoadout("hull_bastion");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_droid"); // tech 5 → 1 + 2.5 = 3.5
    expect(lo.derivedStats().repairRate).toBeCloseTo(3.5, 2);
  });

  it("speed = 0 and canTakeOff = false with no engine", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_tank");
    const s = lo.derivedStats();
    expect(s.speed).toBe(0);
    expect(s.canTakeOff).toBe(false);
  });

  it("canTakeOff = false with no fuel tank", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    expect(lo.derivedStats().canTakeOff).toBe(false);
  });

  it("canTakeOff = true with engine and fuel", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    expect(lo.derivedStats().canTakeOff).toBe(true);
  });

  it("micromodule boosts engine speed proportionally", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i"); // tech 2 → base 0.11
    lo.install("eq_tank");
    lo.applyMicromodule("eq_engine_i", "mm_amplifier_1");
    expect(lo.derivedStats().speed).toBeCloseTo(0.11 * 1.2, 3);
  });
});

describe("ShipLoadout.derivedStats — radar range consumes potency (Task 2)", () => {
  it("radar range equals the installed radar's potency", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_radar_near"); // potency 900
    expect(lo.derivedStats().radarRange).toBe(900);
  });

  it("the best-potency radar wins when two are installed", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("eq_radar_near"); // potency 900
    lo.install("eq_radar_far"); // potency 2200 → wins
    expect(lo.derivedStats().radarRange).toBe(2200);
  });

  it("eq_radar's shipped range is unchanged by the potency switch (600 + 4×200 = 1400)", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_radar");
    expect(lo.derivedStats().radarRange).toBe(1400);
  });

  it("no radar installed → radarRange 0", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    expect(lo.derivedStats().radarRange).toBe(0);
  });
});

describe("ShipLoadout.derivedStats — grapple (GRAPPLE family, Task 2)", () => {
  it("no grapple installed → grappleStrength 0", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    expect(lo.derivedStats().grappleStrength).toBe(0);
  });

  it("grappleStrength equals the installed grapple's potency", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_grapple_i"); // potency 40
    expect(lo.derivedStats().grappleStrength).toBe(40);
  });

  it("the best grapple wins when two are installed", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("eq_grapple_i"); // 40
    lo.install("eq_grapple_iii"); // 180 → wins
    expect(lo.derivedStats().grappleStrength).toBe(180);
  });

  it("micromodule boosts grappleStrength proportionally", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_grapple_ii"); // potency 90
    lo.applyMicromodule("eq_grapple_ii", "mm_amplifier_1"); // +20%
    expect(lo.derivedStats().grappleStrength).toBe(Math.round(90 * 1.2));
  });
});
