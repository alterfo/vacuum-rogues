import { describe, it, expect } from "vitest";
import {
  shipVelocity,
  spawnWreck,
  advanceWreck,
  isWreckDone,
  wreckAlpha,
  wreckLootEmissionTimes,
  dueLootEmissions,
  DEFAULT_WRECK,
  type WreckConfig,
} from "@/presentation/flight/combatWreck";
import { WRECK } from "@/config/balance";

const CFG: WreckConfig = DEFAULT_WRECK;

describe("WRECK config parity (single source of truth)", () => {
  it("balance.ts WRECK mirrors the module default", () => {
    expect(DEFAULT_WRECK).toEqual({
      driftRetentionPerMs: WRECK.driftRetentionPerMs,
      lifeMs: WRECK.lifeMs,
      fadeMs: WRECK.fadeMs,
      spinRatePerSpeed: WRECK.spinRatePerSpeed,
    });
  });
});

describe("shipVelocity — heading + speed → velocity vector", () => {
  it("projects speed onto the heading", () => {
    const v = shipVelocity(0, 0.2);
    expect(v.vx).toBeCloseTo(0.2, 10);
    expect(v.vy).toBeCloseTo(0, 10);
    const up = shipVelocity(Math.PI / 2, 0.2);
    expect(up.vx).toBeCloseTo(0, 10);
    expect(up.vy).toBeCloseTo(0.2, 10);
  });

  it("is zero for a non-finite input", () => {
    expect(shipVelocity(Number.NaN, 0.2)).toEqual({ vx: 0, vy: 0 });
    expect(shipVelocity(0, Number.POSITIVE_INFINITY)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("spawnWreck — inherits the ship's pre-death physics state (Task 14)", () => {
  it("spawns at the ship position with its velocity + heading", () => {
    const w = spawnWreck(100, 50, 0.15, -0.2, 1.2, CFG);
    expect(w.x).toBe(100);
    expect(w.y).toBe(50);
    expect(w.vx).toBeCloseTo(0.15, 10);
    expect(w.vy).toBeCloseTo(-0.2, 10);
    expect(w.angle).toBeCloseTo(1.2, 10);
    expect(w.ageMs).toBe(0);
    expect(w.lifeMs).toBe(CFG.lifeMs);
  });

  it("tumbles harder for a faster ship (spin ∝ inherited speed)", () => {
    const slow = spawnWreck(0, 0, 0.05, 0, 0, CFG);
    const fast = spawnWreck(0, 0, 0.25, 0, 0, CFG);
    expect(fast.spinRate).toBeGreaterThan(slow.spinRate);
    expect(fast.spinRate).toBeCloseTo(CFG.spinRatePerSpeed * 0.25, 10);
  });

  it("a stationary kill barely tumbles (near-zero spin)", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, CFG);
    expect(w.spinRate).toBe(0);
  });

  it("guards non-finite inputs to zero", () => {
    const w = spawnWreck(
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      CFG,
    );
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
    expect(w.vx).toBe(0);
    expect(w.vy).toBe(0);
    expect(w.angle).toBe(0);
    expect(w.spinRate).toBe(0);
  });
});

describe("advanceWreck — drift with inertia + drag decay + tumble", () => {
  it("drifts by its velocity each frame", () => {
    const w = spawnWreck(0, 0, 0.1, 0.2, 0, CFG);
    const next = advanceWreck(w, 100, CFG);
    expect(next.x).toBeCloseTo(0.1 * 100, 6);
    expect(next.y).toBeCloseTo(0.2 * 100, 6);
    expect(next.ageMs).toBe(100);
  });

  it("decays velocity toward zero (drag)", () => {
    const w = spawnWreck(0, 0, 0.3, 0, 0, CFG);
    const next = advanceWreck(w, 500, CFG);
    expect(Math.abs(next.vx)).toBeLessThan(0.3);
    expect(next.vx).toBeGreaterThan(0); // still coasting, not reversed
  });

  it("velocity strictly slows over successive frames", () => {
    let w = spawnWreck(0, 0, 0.3, 0, 0, CFG);
    let prev = Math.abs(w.vx);
    for (let i = 0; i < 5; i++) {
      w = advanceWreck(w, 200, CFG);
      expect(Math.abs(w.vx)).toBeLessThan(prev);
      prev = Math.abs(w.vx);
    }
  });

  it("tumbles the heading by the spin rate", () => {
    const w = spawnWreck(0, 0, 0.2, 0, 0, CFG);
    const next = advanceWreck(w, 100, CFG);
    expect(next.angle).toBeCloseTo(w.angle + w.spinRate * 100, 6);
  });

  it("does not mutate the input state (returns a new object)", () => {
    const w = spawnWreck(0, 0, 0.1, 0, 0, CFG);
    const snapshot = { ...w };
    advanceWreck(w, 100, CFG);
    expect(w).toEqual(snapshot);
  });

  it("holds the state on a non-positive dt", () => {
    const w = spawnWreck(0, 0, 0.1, 0, 0, CFG);
    expect(advanceWreck(w, 0, CFG)).toBe(w);
    expect(advanceWreck(w, -10, CFG)).toBe(w);
  });

  it("is idempotent once done (no dangling drift past despawn)", () => {
    let w = spawnWreck(0, 0, 0.1, 0, 0, CFG);
    w = advanceWreck(w, CFG.lifeMs + 100, CFG);
    expect(isWreckDone(w)).toBe(true);
    const after = advanceWreck(w, 100, CFG);
    expect(after).toBe(w); // unchanged
  });
});

describe("isWreckDone / wreckAlpha — despawn + fade timing", () => {
  it("is not done before its life, done once age reaches life", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, CFG);
    expect(isWreckDone(w)).toBe(false);
    const mid = advanceWreck(w, CFG.lifeMs / 2, CFG);
    expect(isWreckDone(mid)).toBe(false);
    const done = advanceWreck(w, CFG.lifeMs, CFG);
    expect(isWreckDone(done)).toBe(true);
  });

  it("holds full alpha until the fade window, then eases to 0", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, CFG);
    const fadeStart = CFG.lifeMs - CFG.fadeMs;
    expect(wreckAlpha({ ...w, ageMs: fadeStart - 1 }, CFG)).toBe(1);
    expect(wreckAlpha({ ...w, ageMs: fadeStart }, CFG)).toBe(1);
    expect(
      wreckAlpha({ ...w, ageMs: fadeStart + CFG.fadeMs / 2 }, CFG),
    ).toBeCloseTo(0.5, 6);
  });

  it("is 0 at/after despawn", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, CFG);
    expect(wreckAlpha({ ...w, ageMs: CFG.lifeMs }, CFG)).toBe(0);
    expect(wreckAlpha({ ...w, ageMs: CFG.lifeMs + 500 }, CFG)).toBe(0);
  });

  it("alpha is monotonically non-increasing across the life", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, CFG);
    let prev = 1;
    for (let age = 0; age <= CFG.lifeMs; age += CFG.lifeMs / 20) {
      const a = wreckAlpha({ ...w, ageMs: age }, CFG);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it("a zero-life wreck is instantly faded", () => {
    const w = spawnWreck(0, 0, 0, 0, 0, { ...CFG, lifeMs: 0 });
    expect(wreckAlpha(w, { ...CFG, lifeMs: 0 })).toBe(0);
  });
});

describe("wreckLootEmissionTimes — stagger loot across the drift (Task 14)", () => {
  it("spreads N emissions evenly over interior instants (never all at the death point)", () => {
    const times = wreckLootEmissionTimes(4, 4000);
    expect(times).toEqual([500, 1500, 2500, 3500]);
    expect(times.every((t) => t > 0)).toBe(true);
  });

  it("is ascending and strictly within (0, spread)", () => {
    const times = wreckLootEmissionTimes(3, 3000);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(3000);
  });

  it("a single-item drop peels off mid-drift, not at the death point", () => {
    expect(wreckLootEmissionTimes(1, 4000)).toEqual([2000]);
  });

  it("a non-positive count yields no emissions", () => {
    expect(wreckLootEmissionTimes(0, 4000)).toEqual([]);
    expect(wreckLootEmissionTimes(-2, 4000)).toEqual([]);
  });

  it("a non-positive spread collapses all emissions to t=0", () => {
    expect(wreckLootEmissionTimes(3, 0)).toEqual([0, 0, 0]);
  });
});

describe("dueLootEmissions — which drops peel off this frame", () => {
  const times = wreckLootEmissionTimes(4, 4000); // [500,1500,2500,3500]

  it("returns the emission whose time falls in [prev, curr)", () => {
    expect(dueLootEmissions(0, 600, times)).toEqual([0]);
    expect(dueLootEmissions(1000, 2000, times)).toEqual([1]);
  });

  it("is half-open — a boundary emission fires on the frame it opens, not the one it ends", () => {
    expect(dueLootEmissions(500, 1500, times)).toEqual([0]);
    expect(dueLootEmissions(1500, 2500, times)).toEqual([1]);
  });

  it("returns multiple when a slow frame spans several", () => {
    expect(dueLootEmissions(0, 3000, times)).toEqual([0, 1, 2]);
  });

  it("returns none on a non-advancing frame", () => {
    expect(dueLootEmissions(2000, 2000, times)).toEqual([]);
    expect(dueLootEmissions(2000, 1000, times)).toEqual([]);
  });

  it("returns none once every emission is spent", () => {
    expect(dueLootEmissions(3600, 4200, times)).toEqual([]);
  });

  it("integration: every scheduled drop fires exactly once across the drift", () => {
    const fired: number[] = [];
    let age = 0;
    for (let step = 0; step < 40; step++) {
      const next = age + 200;
      fired.push(...dueLootEmissions(age, next, times));
      age = next;
    }
    expect(fired.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
