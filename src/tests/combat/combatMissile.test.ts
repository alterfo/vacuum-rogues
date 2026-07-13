import { describe, it, expect } from "vitest";
import {
  missileTravelTime,
  launchMissile,
  advanceMissile,
  missileHitChance,
  resolveMissileArrival,
  isMissileDone,
  DEFAULT_MISSILE_CONFIG,
  MISSILE_ARRIVAL_EPS,
  type MissileState,
} from "@/presentation/flight/combatMissile";
import { MISSILE_COMBAT } from "@/config/balance";

// A homing/non-homing missile fired from the origin at a target 300px away in +x.
function fire(
  opts: { homing?: boolean; speedPerMs?: number } = {},
): MissileState {
  return launchMissile({
    id: "m1",
    from: { x: 0, y: 0 },
    target: { x: 300, y: 0 },
    speedPerMs: opts.speedPerMs ?? DEFAULT_MISSILE_CONFIG.speedPerMs,
    damage: 40,
    homing: opts.homing ?? false,
  });
}

// Fly a missile to a terminal or arrived state against a (possibly moving) target.
function flyToEnd(
  state: MissileState,
  targetAt: (elapsedMs: number) => { x: number; y: number } | null,
  dtMs = 16,
  maxSteps = 5000,
): MissileState {
  let s = state;
  let elapsed = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (s.status !== "flying") break;
    elapsed += dtMs;
    s = advanceMissile(s, targetAt(elapsed), dtMs, DEFAULT_MISSILE_CONFIG);
  }
  return s;
}

describe("MISSILE_COMBAT config parity (single source of truth)", () => {
  it("balance.ts MISSILE_COMBAT mirrors the module default", () => {
    expect(DEFAULT_MISSILE_CONFIG).toEqual({
      speedPerMs: MISSILE_COMBAT.speedPerMs,
      baseHitChance: MISSILE_COMBAT.baseHitChance,
      minHitChance: MISSILE_COMBAT.minHitChance,
      evasionPerPx: MISSILE_COMBAT.evasionPerPx,
      homingEvasionFactor: MISSILE_COMBAT.homingEvasionFactor,
      maxRangeMultiplier: MISSILE_COMBAT.maxRangeMultiplier,
    });
  });
});

describe("missileTravelTime — distance / speed → ms (Task 7)", () => {
  it("is distance divided by speed", () => {
    expect(missileTravelTime(320, 0.32)).toBeCloseTo(1000, 6);
  });

  it("a faster missile arrives sooner", () => {
    expect(missileTravelTime(320, 0.64)).toBeLessThan(
      missileTravelTime(320, 0.32),
    );
  });

  it("a zero/negative-speed missile never arrives (Infinity)", () => {
    expect(missileTravelTime(320, 0)).toBe(Infinity);
    expect(missileTravelTime(320, -1)).toBe(Infinity);
  });

  it("never returns a negative time", () => {
    expect(missileTravelTime(-50, 0.32)).toBe(0);
  });
});

describe("launchMissile — initial entity state (Task 7)", () => {
  it("starts flying at the launch position, aimed at the target", () => {
    const m = fire();
    expect(m.status).toBe("flying");
    expect(m.pos).toEqual({ x: 0, y: 0 });
    expect(m.heading).toBeCloseTo(0, 6); // straight +x at the target
    expect(m.launchDistance).toBeCloseTo(300, 6);
    expect(m.targetLaunchPos).toEqual({ x: 300, y: 0 });
    expect(isMissileDone(m)).toBe(false);
  });
});

describe("advanceMissile — travel + arrival (Task 7)", () => {
  it("moves toward a stationary target and eventually arrives", () => {
    const end = flyToEnd(fire(), () => ({ x: 300, y: 0 }));
    expect(end.status).toBe("arrived");
    expect(end.pos.x).toBeCloseTo(300, 3);
    expect(end.pos.y).toBeCloseTo(0, 3);
  });

  it("advances the flown distance roughly at speed × dt each step", () => {
    const m = fire({ speedPerMs: 0.1 });
    const s = advanceMissile(m, { x: 300, y: 0 }, 16, DEFAULT_MISSILE_CONFIG);
    expect(s.distanceFlown).toBeCloseTo(1.6, 6);
    expect(s.pos.x).toBeCloseTo(1.6, 6);
  });

  it("arrival snaps the missile onto the aim point", () => {
    const m = fire();
    // One giant step overshoots the 300px target — should snap, not fly past.
    const s = advanceMissile(
      m,
      { x: 300, y: 0 },
      100000,
      DEFAULT_MISSILE_CONFIG,
    );
    expect(s.status).toBe("arrived");
    expect(s.pos).toEqual({ x: 300, y: 0 });
  });

  it("a homing missile re-aims at a moving target and still arrives", () => {
    // Target drifts in +y while the missile chases it.
    const end = flyToEnd(fire({ homing: true }), (t) => ({
      x: 300,
      y: t * 0.02,
    }));
    expect(end.status).toBe("arrived");
    expect(end.pos.y).toBeGreaterThan(0); // curved to intercept the drift
  });
});

describe("advanceMissile — clean despawn, no dangling entity (Task 7)", () => {
  it("a destroyed/removed target (null) resolves to a clean miss", () => {
    const m = fire();
    const s = advanceMissile(m, null, 16, DEFAULT_MISSILE_CONFIG);
    expect(s.status).toBe("miss");
    expect(isMissileDone(s)).toBe(true);
  });

  it("a target that outruns the missile past its range budget expires", () => {
    // Non-homing missile aimed at (300,0); target flees far away so the missile,
    // flying its fixed line, blows its range budget without arriving.
    const slow = launchMissile({
      id: "m2",
      from: { x: 0, y: 0 },
      target: { x: 300, y: 0 },
      speedPerMs: DEFAULT_MISSILE_CONFIG.speedPerMs,
      damage: 40,
      homing: false,
    });
    // Homing at a target that runs directly away faster than the missile flies.
    const runner = launchMissile({
      id: "m3",
      from: { x: 0, y: 0 },
      target: { x: 300, y: 0 },
      speedPerMs: 0.1,
      damage: 40,
      homing: true,
    });
    const end = flyToEnd(runner, (t) => ({ x: 300 + t * 0.5, y: 0 }));
    expect(end.status).toBe("expired");
    expect(isMissileDone(end)).toBe(true);
    // Sanity: the fixed-line missile against a stationary aim still arrives (control).
    const control = flyToEnd(slow, () => ({ x: 300, y: 0 }));
    expect(control.status).toBe("arrived");
  });

  it("advancing a done missile is idempotent (no further movement)", () => {
    const done: MissileState = { ...fire(), status: "hit" };
    const s = advanceMissile(
      done,
      { x: 300, y: 0 },
      16,
      DEFAULT_MISSILE_CONFIG,
    );
    expect(s).toBe(done);
  });

  it("advancing an arrived missile does not move it further", () => {
    const arrived: MissileState = { ...fire(), status: "arrived" };
    const s = advanceMissile(
      arrived,
      { x: 300, y: 0 },
      16,
      DEFAULT_MISSILE_CONFIG,
    );
    expect(s).toBe(arrived);
  });
});

describe("missileHitChance — evasion curve (Task 7)", () => {
  it("a stationary target is hit at baseHitChance", () => {
    const m = fire(); // targetDisplacement = 0
    expect(missileHitChance(m)).toBeCloseTo(
      DEFAULT_MISSILE_CONFIG.baseHitChance,
      6,
    );
  });

  it("more target displacement lowers the hit chance", () => {
    const still = { ...fire(), targetDisplacement: 0 };
    const weaving = { ...fire(), targetDisplacement: 100 };
    expect(missileHitChance(weaving)).toBeLessThan(missileHitChance(still));
  });

  it("is floored at minHitChance for a wildly-maneuvering target", () => {
    const frantic = { ...fire(), targetDisplacement: 100000 };
    expect(missileHitChance(frantic)).toBeCloseTo(
      DEFAULT_MISSILE_CONFIG.minHitChance,
      6,
    );
  });

  it("a homing missile resists evasion better than a dumb one at equal displacement", () => {
    const disp = 200;
    const dumb = { ...fire({ homing: false }), targetDisplacement: disp };
    const homing = { ...fire({ homing: true }), targetDisplacement: disp };
    expect(missileHitChance(homing)).toBeGreaterThan(missileHitChance(dumb));
  });

  it("evasion penalty is linear in displacement (below the floor)", () => {
    const cfg = DEFAULT_MISSILE_CONFIG;
    const at = (d: number) =>
      missileHitChance({ ...fire(), targetDisplacement: d });
    // Two small displacements well above the floor: the drop is evasionPerPx × Δd.
    expect(at(50) - at(100)).toBeCloseTo(cfg.evasionPerPx * 50, 6);
  });
});

describe("resolveMissileArrival — hit/miss settlement with injected roll (Task 7)", () => {
  it("a low roll under the hit chance is a hit", () => {
    const arrived: MissileState = {
      ...fire(),
      status: "arrived",
      targetDisplacement: 0,
    };
    const s = resolveMissileArrival(arrived, 0.01);
    expect(s.status).toBe("hit");
  });

  it("a high roll above the hit chance is a miss", () => {
    const arrived: MissileState = {
      ...fire(),
      status: "arrived",
      targetDisplacement: 0,
    };
    const s = resolveMissileArrival(arrived, 0.99);
    expect(s.status).toBe("miss");
  });

  it("a maneuvering target survives a mid roll a stationary one would not", () => {
    const roll = 0.5;
    const still: MissileState = {
      ...fire(),
      status: "arrived",
      targetDisplacement: 0,
    };
    const weaving: MissileState = {
      ...fire(),
      status: "arrived",
      targetDisplacement: 500,
    };
    expect(resolveMissileArrival(still, roll).status).toBe("hit"); // base ~0.95 > 0.5
    expect(resolveMissileArrival(weaving, roll).status).toBe("miss"); // floored below 0.5
  });

  it("only settles an arrived missile — a flying one is unchanged", () => {
    const flying = fire();
    expect(resolveMissileArrival(flying, 0.01)).toBe(flying);
  });
});

describe("integration — stationary vs. actively-maneuvering target (Task 7)", () => {
  it("a stationary target accumulates no displacement; a weaving one accumulates a lot", () => {
    const still = flyToEnd(fire({ homing: true }), () => ({ x: 300, y: 0 }));
    const weaving = flyToEnd(fire({ homing: true }), (t) => ({
      x: 300 + Math.sin(t * 0.02) * 40,
      y: Math.cos(t * 0.02) * 40,
    }));
    expect(still.status).toBe("arrived");
    expect(still.targetDisplacement).toBeCloseTo(0, 3);
    expect(weaving.targetDisplacement).toBeGreaterThan(0);
    // The weaving target is meaningfully harder to hit.
    expect(missileHitChance(weaving)).toBeLessThan(missileHitChance(still));
  });

  it("MISSILE_ARRIVAL_EPS is a small positive px threshold", () => {
    expect(MISSILE_ARRIVAL_EPS).toBeGreaterThan(0);
    expect(MISSILE_ARRIVAL_EPS).toBeLessThan(50);
  });
});
