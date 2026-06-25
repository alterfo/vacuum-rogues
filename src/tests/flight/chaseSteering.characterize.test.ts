import { describe, it, expect } from "vitest";
import { solveInterceptPoint } from "@/utils/intercept";
import { shouldReaim } from "@/utils/flightGeometry";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 1 — characterize the auto-follow / combat-pursuit *stutter* (red signal).
 *
 * The chase steers the player ship by repeatedly re-aiming at the moving
 * target's lead point (`NpcShipManager.npcLeadPoint` → `aimRoute` /
 * `updateCombatPursuit`). The lead point is solved from a *heading-derived*
 * target velocity (`cos/sin(sprite.rotation) * npcSpeed`), and a chased NPC is
 * itself an arcing, steered ship — so its rendered heading wobbles frame to
 * frame. `solveInterceptPoint` multiplies that velocity by the (large) time to
 * intercept, so a tiny heading wobble whips the aim point a long way, and each
 * whip past `REAIM_DRIFT_PX` re-plots a fresh curved route. This test pins down
 * the resulting jitter so Task 2/3 can prove the fix.
 *
 * Mirrors the live formula in `NpcShipManager.npcLeadPoint` (kept local + pure
 * so the metric is assertable without booting PixiJS).
 */

/** A smooth aim should not jump much more than the target moves in one frame. */
export const SMOOTH_BOUND_PX = 8;

/** Re-aim threshold used by the live chase loop (`NpcShipManager.REAIM_DRIFT_PX`). */
const REAIM_DRIFT_PX = 30;

/** Deterministic [-1,1] noise so the characterization is stable across runs. */
function lcgNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * The raw lead point exactly as `npcLeadPoint` computes it: NPC velocity from
 * its (noisy) rendered heading × the shared cruise speed, fed to the intercept
 * solver against the shooter's position + max speed.
 */
function rawLeadPoint(
  shooterX: number,
  shooterY: number,
  shooterSpeed: number,
  targetX: number,
  targetY: number,
  heading: number,
): { x: number; y: number } {
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

interface ChaseMetrics {
  maxAimJumpPx: number;
  replotsPerSecond: number;
}

/**
 * Simulate a chase against a *steadily-moving* target (constant true heading,
 * cruising at `npcSpeed`) whose rendered heading carries small per-frame noise —
 * the noisy velocity estimate the overview calls out. Returns the worst
 * per-frame aim jump and how often the route would be re-plotted.
 */
function simulateRawChase(): ChaseMetrics {
  const dtMs = 16; // ~60 fps frame
  const frames = 240; // ~4 s of chase
  const shooterSpeed = 0.3; // player faster than npc (0.2), as in intercept.test
  const noise = lcgNoise(0xc0ffee);
  const headingNoiseRad = 0.04; // ±~2.3° rendered-heading wobble on an arcing NPC

  // Player closing from the left; target cruising along +x, well out of range.
  let shooterX = 0;
  const shooterY = 0;
  let targetX = 600;
  const targetY = 0;
  const trueHeading = 0; // steady: moving straight along +x

  let lastAim: { x: number; y: number } | null = null;
  let lastReplot: { x: number; y: number } | null = null;
  let maxAimJumpPx = 0;
  let replots = 0;

  for (let f = 0; f < frames; f++) {
    // Target advances steadily along its true heading.
    targetX += Math.cos(trueHeading) * GAME_BALANCE.npcSpeed * dtMs;
    // Shooter closes straight toward the target (idealized — isolates aim jitter
    // from the player's own motion).
    shooterX += shooterSpeed * dtMs;

    const renderedHeading = trueHeading + noise() * headingNoiseRad;
    const aim = rawLeadPoint(
      shooterX,
      shooterY,
      shooterSpeed,
      targetX,
      targetY,
      renderedHeading,
    );

    if (lastAim) {
      maxAimJumpPx = Math.max(
        maxAimJumpPx,
        Math.hypot(aim.x - lastAim.x, aim.y - lastAim.y),
      );
    }
    lastAim = aim;

    // Re-aim gate (live `shouldReaim`): a fresh leg always re-plots; otherwise
    // only once the aim drifts past the threshold.
    if (!lastReplot || shouldReaim(lastReplot, aim, REAIM_DRIFT_PX)) {
      replots++;
      lastReplot = aim;
    }
  }

  const seconds = (frames * dtMs) / 1000;
  return { maxAimJumpPx, replotsPerSecond: replots / seconds };
}

describe("chase steering — current stutter (Task 1 characterization)", () => {
  it("the raw lead point jitters far past the smoothness bound", () => {
    const { maxAimJumpPx } = simulateRawChase();
    // RED SIGNAL: the un-smoothed aim whips around much more than a target
    // moving steadily ever should per frame. Task 2/3 bring this under bound.
    expect(maxAimJumpPx).toBeGreaterThan(SMOOTH_BOUND_PX);
  });

  it("re-plots the curved route many times per second (course thrash)", () => {
    const { replotsPerSecond } = simulateRawChase();
    // RED SIGNAL: re-aiming re-plots a fresh catmull-rom route far more than
    // once per second instead of nudging the heading.
    expect(replotsPerSecond).toBeGreaterThan(1);
  });
});
