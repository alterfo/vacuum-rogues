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

    manager.updateCombat(dtMs);
    physics.update(dtMs);

    // Aim smoothness: the point fed to physics must not whip frame-to-frame.
    // Skip the first frame (initial seed jumps from the parked target at 0,0).
    const aim = { x: physics.getTargetX(), y: physics.getTargetY() };
    if (f >= 1 && prevAim) {
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
