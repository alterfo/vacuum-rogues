import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { avoidStarPath } from "@/utils/flightGeometry";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 3 — continuous turn-rate steering for moving targets (smooth-auto-follow).
 *
 * The in-combat pursuit now steers the ship continuously toward a *smoothed*
 * lead point via the ShipPhysics turn-rate limiter, instead of re-plotting a
 * fresh curved spline every chase frame (the Task 1 stutter: ≈72px aim jumps,
 * ≈15 re-plots/sec). This drives the *real* `NpcShipManager.updateCombatPursuit`
 * against a noisy-heading moving target and proves the live behaviour is now
 * bounded: the aim point moves ≤ the Task 1 smoothness bound per frame, the ship
 * heading never snaps (turn-rate-limited), the curved re-plot is no longer fired
 * every frame, and the pursuit still closes to and holds weapon range.
 */

const WR = GAME_BALANCE.weaponRange;
const SMOOTH_BOUND_PX = 8; // the Task 1 characterization smoothness bound
const ROTATION_SPEED = Math.PI / 2 / 300; // ShipPhysics rad/ms (kept in sync)

function renderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function makeNpc(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: GAME_BALANCE.npcSpeed,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function spriteOf(manager: NpcShipManager): NpcShipSprite & {
  x: number;
  y: number;
  container: { rotation: number };
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & {
    x: number;
    y: number;
    container: { rotation: number };
  };
}

/** Deterministic [-1,1] noise — mirrors the Task 1 characterization. */
function lcgNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

interface SteerResult {
  maxAimJumpPx: number;
  maxAngleStepRad: number;
  maxAllowedAngleStepRad: number;
  routeReplots: number;
  finalDist: number;
  startDist: number;
}

/**
 * Drive the real combat pursuit against a steadily-moving target whose rendered
 * heading carries the same per-frame noise the Task 1 characterization used.
 */
function runChase(): SteerResult {
  const dtMs = 50;
  const frames = 300;
  const physics = new ShipPhysics(0, 0, 0.5); // player faster than npc (0.2)
  const routeCalls: Array<{ x: number; y: number }> = [];

  const galaxy = {
    npcShips: [makeNpc("trd_1")],
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    // The scene plumbs the curved re-plot into physics; record each call so the
    // test can prove the spline is NOT rebuilt every frame.
    executeRouteTo: (x, y) => {
      routeCalls.push({ x, y });
      physics.setTarget(x, y);
    },
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => true,
    getCombatTargetId: () => "trd_1",
    isPaused: () => false,
    // No star radius wired ⇒ no star fallback (clear shot) → the steering uses
    // the direct heading nudge every frame.
  };

  const manager = new NpcShipManager(
    renderer(),
    gameEngine,
    new Container(),
    new Container(),
    deps,
  );
  manager.initialize();
  const target = spriteOf(manager);
  let targetX = 700;
  target.x = targetX;
  target.y = 0;

  const noise = lcgNoise(0xc0ffee);
  const headingNoiseRad = 0.04; // ±~2.3° rendered-heading wobble on an arcing NPC

  const startDist = Math.hypot(
    target.x - physics.shipX,
    target.y - physics.shipY,
  );
  let maxAimJumpPx = 0;
  let maxAngleStepRad = 0;
  let maxAllowedAngleStepRad = 0;
  let prevAim: { x: number; y: number } | null = null;
  let prevAngle = physics.shipAngle;
  let reachedWR = false;
  let framesAfterWR = 0;

  for (let f = 0; f < frames; f++) {
    // Target cruises steadily along +x; its rendered heading wobbles per frame.
    targetX += GAME_BALANCE.npcSpeed * dtMs;
    target.x = targetX;
    target.container.rotation = noise() * headingNoiseRad; // ≈ heading 0 (+x)

    // Pre-steer distance decides whether this frame is still the *approach* chase
    // (the phase this smoothness metric pins) or the in-range circle-strafe. The
    // combat orbit (range-keeping inside weapon range) deliberately steers toward a
    // far heading carrot — a separate phase, exactly the "in-range hold" this test
    // documents it does NOT mean to measure; only the approach aim must stay smooth.
    const approachPhase =
      Math.hypot(target.x - physics.shipX, target.y - physics.shipY) > WR;

    manager.updateCombat(dtMs);
    physics.update(dtMs);

    // Aim smoothness: the point fed to physics must not whip frame-to-frame during
    // the approach. Skip the first frame (initial seed jumps from the parked target
    // at 0,0).
    const aim = { x: physics.getTargetX(), y: physics.getTargetY() };
    if (f >= 1 && prevAim && approachPhase) {
      maxAimJumpPx = Math.max(
        maxAimJumpPx,
        Math.hypot(aim.x - prevAim.x, aim.y - prevAim.y),
      );
    }
    prevAim = aim;

    // Heading must never snap: |Δangle| ≤ rotationSpeed × capped-dt each frame.
    let dAng = Math.abs(physics.shipAngle - prevAngle);
    while (dAng > Math.PI) dAng = Math.abs(dAng - 2 * Math.PI);
    maxAngleStepRad = Math.max(maxAngleStepRad, dAng);
    maxAllowedAngleStepRad = ROTATION_SPEED * Math.min(dtMs, 100);
    prevAngle = physics.shipAngle;

    const d = Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
    if (d <= WR) reachedWR = true;
    // Stop a little after reaching weapon range: the in-range "hold station"
    // (ship coasts in, stops, target drifts out, re-accelerates) is a separate,
    // pre-existing behaviour — measuring it would conflate the hold's natural
    // stop-start re-plots with the *approach-phase* course thrash this test pins.
    if (reachedWR && ++framesAfterWR > 20) break;
  }

  const finalDist = Math.hypot(
    target.x - physics.shipX,
    target.y - physics.shipY,
  );
  manager.destroy();
  // reachedWR is folded into finalDist assertions by the caller.
  void reachedWR;
  return {
    maxAimJumpPx,
    maxAngleStepRad,
    maxAllowedAngleStepRad,
    routeReplots: routeCalls.length,
    finalDist,
    startDist,
  };
}

describe("smooth chase steering — continuous turn-rate pursuit (Task 3)", () => {
  it("the aim point fed to physics stays under the Task 1 smoothness bound", () => {
    const { maxAimJumpPx } = runChase();
    // Task 1 RED was ≈72px; smoothing now keeps the per-frame aim move ≤ 8px.
    expect(maxAimJumpPx).toBeLessThanOrEqual(SMOOTH_BOUND_PX);
  });

  it("the ship heading is turn-rate-limited every frame (no snap)", () => {
    const { maxAngleStepRad, maxAllowedAngleStepRad } = runChase();
    expect(maxAngleStepRad).toBeLessThanOrEqual(maxAllowedAngleStepRad + 1e-6);
  });

  it("does NOT re-plot the curved spline every frame (no course thrash)", () => {
    const { routeReplots } = runChase();
    // The Task 1 thrash was ≈15 re-plots/sec over a 30s chase (~hundreds);
    // continuous steering re-plots only on a fresh leg, so it stays tiny.
    expect(routeReplots).toBeLessThan(10);
  });

  it("still closes to and holds weapon range", () => {
    const { finalDist, startDist } = runChase();
    expect(finalDist).toBeLessThan(startDist);
    expect(finalDist).toBeLessThanOrEqual(WR);
  });
});

interface StarChaseResult {
  /** Curved re-plots before the star dropped onto the chase line (just the fresh leg). */
  replotsBeforeBlock: number;
  /** Frame offset (after the block) of the first curved bypass re-plot; -1 = never. */
  framesToFirstReplotAfterBlock: number;
  /** Re-plots fired after the path became blocked. */
  replotsAfterBlock: number;
}

/**
 * Drive the real combat pursuit against a STEADY-heading target (so the lead
 * barely drifts and the 30px re-aim gate never trips), then drop the star directly
 * onto the ship→lead line mid-flight. The bypass re-plot must fire the instant the
 * path becomes blocked — a safety re-plot can't wait on the target-drift gate, or
 * a target that doesn't drift would leave the ship steering straight at the star.
 */
function runChaseAcrossStar(): StarChaseResult {
  const dtMs = 50;
  const frames = 200;
  const blockFrame = 15; // well past REPLOT_MIN_INTERVAL_MS so only the drift gate is in play
  const avoidRadius = 120;
  const physics = new ShipPhysics(0, 0, 0.5);
  const routeCalls: Array<{ x: number; y: number }> = [];
  let starCenter = { x: 400, y: 6000 }; // far off the line ⇒ clear shot initially

  const galaxy = {
    npcShips: [makeNpc("trd_1")],
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => starCenter,
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    // Mirror the real scene's executeRouteTo: bow around the star when the straight
    // segment is blocked, else a direct target — so the ship follows a realistic
    // path (it does NOT plough straight through the star once it re-plots).
    executeRouteTo: (x, y) => {
      routeCalls.push({ x, y });
      const path = avoidStarPath(
        physics.shipX,
        physics.shipY,
        x,
        y,
        starCenter.x,
        starCenter.y,
        avoidRadius,
      );
      if (path.length > 1) physics.setPath(path);
      else physics.setTarget(x, y);
    },
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => true,
    getCombatTargetId: () => "trd_1",
    isPaused: () => false,
    getStarAvoidRadius: () => avoidRadius,
  };

  const manager = new NpcShipManager(
    renderer(),
    gameEngine,
    new Container(),
    new Container(),
    deps,
  );
  manager.initialize();
  const target = spriteOf(manager);
  let targetX = 700;
  target.x = targetX;
  target.y = 0;

  let replotsBeforeBlock = 0;
  let framesToFirstReplotAfterBlock = -1;

  for (let f = 0; f < frames; f++) {
    targetX += GAME_BALANCE.npcSpeed * dtMs;
    target.x = targetX;
    target.container.rotation = 0; // steady heading (+x): minimal lead drift

    if (f === blockFrame) {
      replotsBeforeBlock = routeCalls.length;
      // Drop the star onto the segment between the ship and the (ahead) target so
      // the straight shot now crosses it — the clear→blocked transition mid-flight.
      starCenter = { x: (physics.shipX + target.x) / 2, y: 0 };
    }

    manager.updateCombat(dtMs);
    physics.update(dtMs);

    if (
      f >= blockFrame &&
      framesToFirstReplotAfterBlock < 0 &&
      routeCalls.length > replotsBeforeBlock
    ) {
      framesToFirstReplotAfterBlock = f - blockFrame;
    }
  }

  manager.destroy();
  return {
    replotsBeforeBlock,
    framesToFirstReplotAfterBlock,
    replotsAfterBlock: routeCalls.length - replotsBeforeBlock,
  };
}

describe("smooth chase steering — star-avoidance is not drift-gated (Task 3)", () => {
  it("does not re-plot while clear-shot against a steady (non-drifting) target", () => {
    const { replotsBeforeBlock } = runChaseAcrossStar();
    // Only the fresh-leg plot — the 30px re-aim gate never trips on a steady
    // heading, so the clear-shot phase is a pure direct-nudge (no spline thrash).
    expect(replotsBeforeBlock).toBeLessThanOrEqual(1);
  });

  it("re-plots the curved bypass the instant the path becomes blocked", () => {
    const { framesToFirstReplotAfterBlock, replotsAfterBlock } =
      runChaseAcrossStar();
    // The safety re-plot fires on the very block frame — NOT suppressed by the
    // drift gate (which a non-drifting target would never trip). Regression guard
    // for the bug where the bypass was gated behind the 30px target-drift threshold.
    expect(framesToFirstReplotAfterBlock).toBe(0);
    expect(replotsAfterBlock).toBeGreaterThanOrEqual(1);
  });
});
