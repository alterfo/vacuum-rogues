import { describe, it, expect } from "vitest";
import { solveInterceptPoint } from "@/utils/intercept";
import { shouldReaim } from "@/utils/flightGeometry";
import { GAME_BALANCE } from "@/config/balance";

export const SMOOTH_BOUND_PX = 8;

const REAIM_DRIFT_PX = 30;

function lcgNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

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

function simulateRawChase(): ChaseMetrics {
  const dtMs = 16; // ~60 fps frame
  const frames = 240; // ~4 s of chase
  const shooterSpeed = 0.3; // player faster than npc (0.2), as in intercept.test
  const noise = lcgNoise(0xc0ffee);
  const headingNoiseRad = 0.04; // ±~2.3° rendered-heading wobble on an arcing NPC

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
    targetX += Math.cos(trueHeading) * GAME_BALANCE.npcSpeed * dtMs;
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
    expect(maxAimJumpPx).toBeGreaterThan(SMOOTH_BOUND_PX);
  });

  it("re-plots the curved route many times per second (course thrash)", () => {
    const { replotsPerSecond } = simulateRawChase();
    expect(replotsPerSecond).toBeGreaterThan(1);
  });
});
