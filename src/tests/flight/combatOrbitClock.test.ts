import { describe, it, expect } from "vitest";
import {
  combatOrbitalDayIncrement,
  MS_PER_ORBITAL_DAY,
} from "@/presentation/flight/combatOrbitClock";

describe("combatOrbitalDayIncrement", () => {
  it("uses the wait-turn day rate (день = секунда)", () => {
    expect(MS_PER_ORBITAL_DAY).toBe(1000);
  });

  it("advances during the real-time portion of a fight (inCombat && !paused)", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: true,
      paused: false,
      dt: 300,
      timeScale: 1,
    });
    expect(inc).toBeCloseTo(0.3, 10); // 300 ms at the wait-turn rate = 0.3 day
  });

  it("holds (0) while the active pause is up", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: true,
      paused: true,
      dt: 300,
      timeScale: 1,
    });
    expect(inc).toBe(0); // pause = everything frozen, including orbits
  });

  it("holds (0) when no fight is engaged (move/wait stay the only day sources)", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: false,
      paused: false,
      dt: 300,
      timeScale: 1,
    });
    expect(inc).toBe(0);
  });

  it("scales by timeScale (combat pacing tracks the wait-turn rate)", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: true,
      paused: false,
      dt: 200,
      timeScale: 2,
    });
    expect(inc).toBeCloseTo(0.4, 10); // (200 × 2) / 1000
  });

  it("clamps dt to one day so a backgrounded-tab resume frame can't flush a long stretch", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: true,
      paused: false,
      dt: 60_000, // a 60 s resume frame
      timeScale: 1,
    });
    expect(inc).toBe(1); // clamped to exactly one orbital day, not 60
  });

  it("never goes negative for a (defensive) negative dt", () => {
    const inc = combatOrbitalDayIncrement({
      inCombat: true,
      paused: false,
      dt: -50,
      timeScale: 1,
    });
    expect(inc).toBe(0);
  });
});
