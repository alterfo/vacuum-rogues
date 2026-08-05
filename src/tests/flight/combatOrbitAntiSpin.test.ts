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

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by;
  const la = Math.hypot(ax, ay) || 1;
  const lb = Math.hypot(bx, by) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb))));
}

describe("combat orbit anti-spin (close-range degenerate guard)", () => {
  it("steers AWAY (radial escape), not tangentially, when the target is nearly on top", () => {
    const { manager, physics, target } = setup();
    target.x = 12;
    target.y = 0;

    manager.updateCombat(50);

    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    const awayX = physics.shipX - target.x;
    const awayY = physics.shipY - target.y;
    const deg = (angleBetween(steerX, steerY, awayX, awayY) * 180) / Math.PI;

    expect(deg).toBeLessThan(30);
    manager.destroy();
  });

  it("still circles (tangential) at the steady orbit radius", () => {
    const { manager, physics, target } = setup();
    target.x = ORBIT;
    target.y = 0;

    manager.updateCombat(50);

    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    const awayX = physics.shipX - target.x;
    const awayY = physics.shipY - target.y;
    const deg = (angleBetween(steerX, steerY, awayX, awayY) * 180) / Math.PI;

    expect(deg).toBeGreaterThan(60);
    manager.destroy();
  });
});
