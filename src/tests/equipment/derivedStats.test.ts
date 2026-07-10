import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

describe("ShipLoadout.derivedStats — tech-based formulas (Task 6)", () => {
  it("engine speed = 0.066 + techLevel × 0.022 px/ms", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i"); // tech 2
    lo.install("eq_tank");
    const s = lo.derivedStats();
    // tech 2: 0.066 + 2*0.022 = 0.11
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
    // level-1 micromodule = +20%
    lo.applyMicromodule("eq_engine_i", "mm_amplifier_1");
    // 0.11 * 1.20 = 0.132
    expect(lo.derivedStats().speed).toBeCloseTo(0.11 * 1.2, 3);
  });
});
