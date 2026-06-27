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
 * Playtest report (2026-06-27, Issue 1): "ship spins on its own axis + camera
 * circles when attacked at game start." When a combat target sits nearly on top
 * of the player (a too-close spawn attack), the combat strafe orbit collapsed to
 * tight, fast revolutions — the ship wound round and round in place and the
 * auto-follow camera circled with it.
 *
 * Fix (`steerCombatOrbit`): well inside the orbit radius the tangential
 * (circling) steering component fades out, so the ship backs STRAIGHT out to
 * range (radial-dominated) instead of spiralling. This drives the REAL pursuit
 * and asserts the steer direction points away from a nearly-coincident target
 * (no tight orbit), while the steady orbit at full range still circles.
 */

const WR = GAME_BALANCE.weaponRange;
const ORBIT = WR * 0.6;

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
    role: NpcRole.PIRATE,
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

/** Build a manager with one combat target, the player physics at the origin. */
function setup(): {
  manager: NpcShipManager;
  physics: ShipPhysics;
  target: NpcShipSprite & { x: number; y: number };
} {
  const physics = new ShipPhysics(0, 0, 0.5);
  const galaxy = {
    npcShips: [makeNpc("pir_1")],
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
    executeRouteTo: (x, y) => physics.setTarget(x, y),
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => true,
    getCombatTargetId: () => "pir_1",
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
  const target = (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & { x: number; y: number };
  return { manager, physics, target };
}

/** Angle (rad) between two direction vectors. */
function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by;
  const la = Math.hypot(ax, ay) || 1;
  const lb = Math.hypot(bx, by) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb))));
}

describe("combat orbit anti-spin (close-range degenerate guard)", () => {
  it("steers AWAY (radial escape), not tangentially, when the target is nearly on top", () => {
    const { manager, physics, target } = setup();
    // Target almost coincident with the player, and the player happens to face
    // straight at it (worst case for a tight spin).
    target.x = 12;
    target.y = 0;

    manager.updateCombat(50);

    // The combat steer is plotted as a far carrot via setPath — its direction
    // from the ship is what the hull turns toward.
    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    // "Away from target" = from the target toward the ship.
    const awayX = physics.shipX - target.x;
    const awayY = physics.shipY - target.y;
    const deg = (angleBetween(steerX, steerY, awayX, awayY) * 180) / Math.PI;

    // Radial-dominated escape: the steer is within ~30° of straight away from
    // the target — NOT the ~45°+ tangential heading that span the ship in place.
    expect(deg).toBeLessThan(30);
    manager.destroy();
  });

  it("still circles (tangential) at the steady orbit radius", () => {
    const { manager, physics, target } = setup();
    // Target at the orbit standoff — the tangent must be fully restored so the
    // ship strafes around it (the orbit fix is unchanged at proper range).
    target.x = ORBIT;
    target.y = 0;

    manager.updateCombat(50);

    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    const awayX = physics.shipX - target.x;
    const awayY = physics.shipY - target.y;
    const deg = (angleBetween(steerX, steerY, awayX, awayY) * 180) / Math.PI;

    // At orbit range the steer is essentially perpendicular to the radial (a
    // tangential strafe), so the angle to "away" is near 90° — it circles.
    expect(deg).toBeGreaterThan(60);
    manager.destroy();
  });
});
