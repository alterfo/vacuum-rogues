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
    executeRouteTo: (x, y) => {
      routeCalls.push({ x, y });
      physics.setTarget(x, y);
    },
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => true,
    getCombatTargetId: () => "trd_1",
    isPaused: () => false,
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
    targetX += GAME_BALANCE.npcSpeed * dtMs;
    target.x = targetX;
    target.container.rotation = noise() * headingNoiseRad; // ≈ heading 0 (+x)

    const approachPhase =
      Math.hypot(target.x - physics.shipX, target.y - physics.shipY) > WR;

    manager.updateCombat(dtMs);
    physics.update(dtMs);

    const aim = { x: physics.getTargetX(), y: physics.getTargetY() };
    if (f >= 1 && prevAim && approachPhase) {
      maxAimJumpPx = Math.max(
        maxAimJumpPx,
        Math.hypot(aim.x - prevAim.x, aim.y - prevAim.y),
      );
    }
    prevAim = aim;

    let dAng = Math.abs(physics.shipAngle - prevAngle);
    while (dAng > Math.PI) dAng = Math.abs(dAng - 2 * Math.PI);
    maxAngleStepRad = Math.max(maxAngleStepRad, dAng);
    maxAllowedAngleStepRad = ROTATION_SPEED * Math.min(dtMs, 100);
    prevAngle = physics.shipAngle;

    const d = Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
    if (d <= WR) reachedWR = true;
    if (reachedWR && ++framesAfterWR > 20) break;
  }

  const finalDist = Math.hypot(
    target.x - physics.shipX,
    target.y - physics.shipY,
  );
  manager.destroy();
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
    expect(maxAimJumpPx).toBeLessThanOrEqual(SMOOTH_BOUND_PX);
  });

  it("the ship heading is turn-rate-limited every frame (no snap)", () => {
    const { maxAngleStepRad, maxAllowedAngleStepRad } = runChase();
    expect(maxAngleStepRad).toBeLessThanOrEqual(maxAllowedAngleStepRad + 1e-6);
  });

  it("does NOT re-plot the curved spline every frame (no course thrash)", () => {
    const { routeReplots } = runChase();
    expect(routeReplots).toBeLessThan(10);
  });

  it("still closes to and holds weapon range", () => {
    const { finalDist, startDist } = runChase();
    expect(finalDist).toBeLessThan(startDist);
    expect(finalDist).toBeLessThanOrEqual(WR);
  });
});

interface StarChaseResult {
  replotsBeforeBlock: number;
  framesToFirstReplotAfterBlock: number;
  replotsAfterBlock: number;
}

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
    expect(replotsBeforeBlock).toBeLessThanOrEqual(1);
  });

  it("re-plots the curved bypass the instant the path becomes blocked", () => {
    const { framesToFirstReplotAfterBlock, replotsAfterBlock } =
      runChaseAcrossStar();
    expect(framesToFirstReplotAfterBlock).toBe(0);
    expect(replotsAfterBlock).toBeGreaterThanOrEqual(1);
  });
});
