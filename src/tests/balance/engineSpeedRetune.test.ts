import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

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
