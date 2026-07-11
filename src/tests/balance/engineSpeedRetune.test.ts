import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * Overmind plan Task 6: the apex engine should be ~2× the starter's cruise
 * speed, not 2.36×. The retuned derived-speed formula
 * `spd = (0.066 + techLevel × 0.022) × m` holds the starter (tech 2) at
 * exactly 0.11 px/ms and lands the apex (tech 7) at 0.22 px/ms.
 */
describe("engine speed retune — apex is ~2× starter (plan Task 6)", () => {
  function speedWith(engineId: string): number {
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.install(engineId)).toBe(true);
    return lo.derivedStats().speed;
  }

  it("starter engine (eq_engine_i, tech 2) keeps its 0.11 px/ms cruise speed", () => {
    expect(speedWith("eq_engine_i")).toBeCloseTo(0.11, 3);
  });

  it("apex engine (eq_engine_v, tech 7) derives 0.22 px/ms — 2× the starter", () => {
    const starter = speedWith("eq_engine_i");
    const apex = speedWith("eq_engine_v");
    expect(apex).toBeCloseTo(0.22, 3);
    expect(apex / starter).toBeCloseTo(2, 2);
  });
});
