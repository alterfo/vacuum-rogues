import { describe, it, expect } from "vitest";
import {
  pristineEngine,
  canAfterburn,
  afterburnerMultiplier,
  engageAfterburner,
  afterburnerBurnBudget,
  DEFAULT_AFTERBURNER,
  type EngineWearState,
} from "@/presentation/flight/combatAfterburner";
import { AFTERBURNER } from "@/config/balance";

const CFG = DEFAULT_AFTERBURNER;

describe("AFTERBURNER config parity (single source of truth)", () => {
  it("balance.ts AFTERBURNER mirrors the module default", () => {
    expect(DEFAULT_AFTERBURNER).toEqual({
      speedMultiplier: AFTERBURNER.speedMultiplier,
      wearPerBurn: AFTERBURNER.wearPerBurn,
      minIntegrityToEngage: AFTERBURNER.minIntegrityToEngage,
    });
  });
});

describe("pristineEngine / canAfterburn", () => {
  it("a fresh engine is pristine (integrity 1) and can afterburn", () => {
    const e = pristineEngine();
    expect(e.integrity).toBe(1);
    expect(canAfterburn(e, CFG)).toBe(true);
  });

  it("an engine at/below the engage floor is spent", () => {
    expect(canAfterburn({ integrity: CFG.minIntegrityToEngage }, CFG)).toBe(
      false,
    );
    expect(canAfterburn({ integrity: 0 }, CFG)).toBe(false);
    expect(canAfterburn({ integrity: CFG.minIntegrityToEngage / 2 }, CFG)).toBe(
      false,
    );
  });
});

describe("afterburnerMultiplier — boost tapers with wear (Task 8)", () => {
  it("delivers the full peak multiplier at pristine integrity", () => {
    expect(afterburnerMultiplier(1, CFG)).toBeCloseTo(CFG.speedMultiplier, 10);
  });

  it("tapers linearly toward 1 as integrity drops", () => {
    const peakBoost = CFG.speedMultiplier - 1;
    expect(afterburnerMultiplier(0.5, CFG)).toBeCloseTo(
      1 + peakBoost * 0.5,
      10,
    );
    expect(afterburnerMultiplier(0.9, CFG)).toBeGreaterThan(
      afterburnerMultiplier(0.4, CFG),
    );
  });

  it("is exactly 1 (no boost) once the engine is too worn to engage", () => {
    expect(afterburnerMultiplier(CFG.minIntegrityToEngage, CFG)).toBe(1);
    expect(afterburnerMultiplier(0, CFG)).toBe(1);
  });

  it("never returns a multiplier below 1", () => {
    for (const i of [0, 0.01, 0.05, 0.2, 0.5, 1]) {
      expect(afterburnerMultiplier(i, CFG)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("engageAfterburner — boost applied + engine wears (Task 8)", () => {
  it("a pristine burn applies the peak multiplier and wears the engine", () => {
    const r = engageAfterburner(pristineEngine(), CFG);
    expect(r.engaged).toBe(true);
    expect(r.multiplier).toBeCloseTo(CFG.speedMultiplier, 10);
    expect(r.state.integrity).toBeCloseTo(1 - CFG.wearPerBurn, 10);
  });

  it("degradation accumulates: repeated burns monotonically lower integrity and boost", () => {
    let state: EngineWearState = pristineEngine();
    let prevIntegrity = state.integrity;
    let prevMultiplier = Infinity;
    let burns = 0;
    while (canAfterburn(state, CFG)) {
      const r = engageAfterburner(state, CFG);
      expect(r.engaged).toBe(true);
      expect(r.state.integrity).toBeLessThan(prevIntegrity);
      expect(r.multiplier).toBeLessThanOrEqual(prevMultiplier + 1e-9);
      prevIntegrity = r.state.integrity;
      prevMultiplier = r.multiplier;
      state = r.state;
      burns++;
      expect(burns).toBeLessThan(100); // guard against an infinite loop
    }
    expect(burns).toBe(afterburnerBurnBudget(CFG));
  });

  it("a fully-degraded engine can no longer afterburn (no boost, no further wear)", () => {
    const spent: EngineWearState = { integrity: CFG.minIntegrityToEngage };
    const r = engageAfterburner(spent, CFG);
    expect(r.engaged).toBe(false);
    expect(r.multiplier).toBe(1);
    expect(r.state).toBe(spent); // unchanged — no wear applied to a spent engine
  });

  it("never wears integrity below 0", () => {
    const r = engageAfterburner(
      { integrity: 0.06 },
      { ...CFG, wearPerBurn: 1 },
    );
    expect(r.engaged).toBe(true);
    expect(r.state.integrity).toBe(0);
  });
});

describe("afterburnerBurnBudget — the natural per-fight cap", () => {
  it("matches the number of burns a pristine engine can actually deliver", () => {
    let state: EngineWearState = pristineEngine();
    let burns = 0;
    while (canAfterburn(state, CFG)) {
      state = engageAfterburner(state, CFG).state;
      burns++;
      if (burns > 1000) break;
    }
    expect(burns).toBe(afterburnerBurnBudget(CFG));
  });

  it("is Infinity for a non-positive wearPerBurn (unlimited burns)", () => {
    expect(afterburnerBurnBudget({ ...CFG, wearPerBurn: 0 })).toBe(Infinity);
    expect(afterburnerBurnBudget({ ...CFG, wearPerBurn: -1 })).toBe(Infinity);
  });
});
