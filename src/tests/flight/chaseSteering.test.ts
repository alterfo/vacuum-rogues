import { describe, it, expect } from "vitest";
import {
  smoothLeadPoint,
  shouldReplotRoute,
  type Point,
  type ReaimGateState,
} from "@/utils/flightGeometry";
import { solveInterceptPoint } from "@/utils/intercept";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 2 — the pure pieces of the smooth-chase fix: a lead-point smoother and a
 * re-aim hysteresis gate. The smoother converges monotonically toward a steady
 * lead and hard-bounds the per-frame aim delta; the gate blocks sub-threshold
 * jitter and throttles re-plots to a minimum interval. Task 3 wires these into
 * `NpcShipManager`/`SpaceFlightScene`; here they are proven in isolation.
 */

/**
 * The Task 1 characterization smoothness bound (`chaseSteering.characterize.test`
 * `SMOOTH_BOUND_PX`) — kept in sync here as a literal so this suite stays
 * self-contained (importing the characterize module would re-register its tests).
 */
const SMOOTH_BOUND_PX = 8;

/** Deterministic [-1,1] noise — mirrors the Task 1 characterization. */
function lcgNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/** Raw lead exactly as `npcLeadPoint` / the characterization computes it. */
function rawLeadPoint(
  shooterX: number,
  shooterY: number,
  shooterSpeed: number,
  targetX: number,
  targetY: number,
  heading: number,
): Point {
  const vx = Math.cos(heading) * GAME_BALANCE.npcSpeed;
  const vy = Math.sin(heading) * GAME_BALANCE.npcSpeed;
  return solveInterceptPoint(
    shooterX,
    shooterY,
    shooterSpeed,
    targetX,
    targetY,
    vx,
    vy,
  );
}

const SMOOTHER = { alpha: 0.25, maxStepPx: 6 } as const;

describe("smoothLeadPoint — lead-point smoother", () => {
  it("adopts the raw lead verbatim on the first frame (no previous)", () => {
    const raw: Point = { x: 123, y: -45 };
    expect(smoothLeadPoint(null, raw, SMOOTHER)).toEqual(raw);
  });

  it("converges monotonically toward a constant lead, never overshooting", () => {
    const target: Point = { x: 100, y: 40 };
    let smoothed: Point | null = null;
    let prevDist = Infinity;
    for (let f = 0; f < 200; f++) {
      smoothed = smoothLeadPoint(smoothed, target, SMOOTHER);
      const dist = Math.hypot(smoothed.x - target.x, smoothed.y - target.y);
      // Distance to the fixed lead strictly decreases each step — no oscillation,
      // no overshoot past the target.
      expect(dist).toBeLessThanOrEqual(prevDist + 1e-9);
      prevDist = dist;
    }
    expect(prevDist).toBeLessThan(1e-3); // actually converged
  });

  it("hard-bounds the per-frame aim delta against a noisy steady target", () => {
    const dtMs = 16;
    const frames = 240;
    const shooterSpeed = 0.3;
    const noise = lcgNoise(0xc0ffee);
    const headingNoiseRad = 0.04;

    let shooterX = 0;
    const shooterY = 0;
    let targetX = 600;
    const targetY = 0;
    const trueHeading = 0;

    let smoothed: Point | null = null;
    let last: Point | null = null;
    let maxJump = 0;

    for (let f = 0; f < frames; f++) {
      targetX += Math.cos(trueHeading) * GAME_BALANCE.npcSpeed * dtMs;
      shooterX += shooterSpeed * dtMs;
      const rendered = trueHeading + noise() * headingNoiseRad;
      const raw = rawLeadPoint(
        shooterX,
        shooterY,
        shooterSpeed,
        targetX,
        targetY,
        rendered,
      );
      smoothed = smoothLeadPoint(smoothed, raw, SMOOTHER);
      if (last) {
        maxJump = Math.max(
          maxJump,
          Math.hypot(smoothed.x - last.x, smoothed.y - last.y),
        );
      }
      last = smoothed;
    }

    // The Task 1 RED metric (≈72px raw) is now under the smoothness bound: the
    // clamp guarantees the smoothed aim never moves more than maxStepPx/frame.
    expect(maxJump).toBeLessThanOrEqual(SMOOTHER.maxStepPx + 1e-9);
    expect(maxJump).toBeLessThanOrEqual(SMOOTH_BOUND_PX);
  });

  it("never steps more than maxStepPx even on a huge raw jump", () => {
    const previous: Point = { x: 0, y: 0 };
    const raw: Point = { x: 1000, y: -1000 };
    const out = smoothLeadPoint(previous, raw, { alpha: 1, maxStepPx: 5 });
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(5 + 1e-9);
  });
});

describe("shouldReplotRoute — re-aim hysteresis gate", () => {
  const endpoint: Point = { x: 100, y: 100 };
  const state: ReaimGateState = { endpoint, lastReplotMs: 0 };
  const threshold = 30;
  const minInterval = 1000;

  it("blocks a sub-threshold drift even after the interval elapses", () => {
    const fresh: Point = { x: 110, y: 100 }; // 10px < 30px threshold
    expect(shouldReplotRoute(state, fresh, threshold, 5000, minInterval)).toBe(
      false,
    );
  });

  it("allows an over-threshold drift once the interval has elapsed", () => {
    const fresh: Point = { x: 200, y: 100 }; // 100px > 30px threshold
    expect(shouldReplotRoute(state, fresh, threshold, 1200, minInterval)).toBe(
      true,
    );
  });

  it("blocks an over-threshold drift while still inside the interval (time hysteresis)", () => {
    const fresh: Point = { x: 200, y: 100 }; // would pass the distance gate
    expect(shouldReplotRoute(state, fresh, threshold, 500, minInterval)).toBe(
      false,
    );
  });

  it("throttles a fast-moving target to one re-plot per interval (≥ interval apart)", () => {
    const dtMs = 16;
    const frames = 240; // ~4 s
    const drift = 2; // px/frame — well past threshold over a few frames
    let gate: ReaimGateState = {
      endpoint: { x: 0, y: 0 },
      lastReplotMs: -Infinity,
    };
    let lead: Point = { x: 0, y: 0 };
    const replotTimes: number[] = [];
    for (let f = 0; f < frames; f++) {
      const now = f * dtMs;
      lead = { x: lead.x + drift, y: 0 };
      if (shouldReplotRoute(gate, lead, threshold, now, minInterval)) {
        replotTimes.push(now);
        gate = { endpoint: { ...lead }, lastReplotMs: now };
      }
    }
    // The Task 1 RED metric (~15 re-plots/sec) collapses to one per interval:
    // every consecutive re-plot is at least `minInterval` apart, and the total
    // can't exceed one per interval window.
    for (let i = 1; i < replotTimes.length; i++) {
      expect(replotTimes[i] - replotTimes[i - 1]).toBeGreaterThanOrEqual(
        minInterval,
      );
    }
    expect(replotTimes.length).toBeLessThanOrEqual(
      Math.ceil((frames * dtMs) / minInterval),
    );
  });
});
