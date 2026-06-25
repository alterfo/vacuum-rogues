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
 * Combat break-off (Task 3) — `docs/plans/20260625-combat-orbit-and-flight-persistence-fix.md`.
 *
 * Once a fight is engaged, `updateCombatPursuit` drives the player ship every
 * frame (`setPath`) to hold the target in weapon range — so a player who plots a
 * route to a planet (or to flee) is pinned in the strafe orbit and never reaches
 * it. `breakOffCombatPursuit()` lets a player-committed course override the
 * auto-pursuit: the ship flies the route, and pursuit re-engages only once the
 * route completes (ship stops) — i.e. if a hostile is still in range.
 */

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

type TestSprite = NpcShipSprite & {
  x: number;
  y: number;
  container: { rotation: number };
};

function spriteOf(manager: NpcShipManager): TestSprite {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as TestSprite;
}

function isSuspended(manager: NpcShipManager): boolean {
  return (manager as unknown as { pursuitSuspended: boolean }).pursuitSuspended;
}

function makeManager(): {
  manager: NpcShipManager;
  physics: ShipPhysics;
  target: TestSprite;
} {
  // Player faster than the NPC so closing/holding range is never the bottleneck.
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
    // Star far away — no star-avoidance bend interferes with the headings here.
    getStarCenter: () => ({ x: 100000, y: 100000 }),
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
    // No star radius wired ⇒ direct heading nudge (no bow-around).
  };

  const manager = new NpcShipManager(
    renderer(),
    gameEngine,
    new Container(),
    new Container(),
    deps,
  );
  manager.initialize();
  return { manager, physics, target: spriteOf(manager) };
}

describe("combat break-off: a player route overrides the auto-pursuit (Task 3)", () => {
  it("without break-off, the auto-pursuit overrides the player's route target (pins the ship)", () => {
    const { manager, physics, target } = makeManager();
    // Enemy out of weapon range on +x; player plots a route to a planet on −x.
    target.x = 600;
    target.y = 0;
    target.container.rotation = 0;
    physics.setTarget(-700, 100);

    physics.update(50);
    manager.updateCombat(50);

    // The pursuit re-aimed at the enemy (+x), discarding the player's −x route.
    expect(physics.getTargetX()).toBeGreaterThan(0);
    manager.destroy();
  });

  it("break-off makes the auto-pursuit yield — the player's route target is preserved", () => {
    const { manager, physics, target } = makeManager();
    target.x = 600;
    target.y = 0;
    target.container.rotation = 0;
    manager.breakOffCombatPursuit();
    physics.setTarget(-700, 100);

    physics.update(50);
    manager.updateCombat(50);

    // The pursuit did NOT touch the route — the player's −x planet course stands.
    expect(physics.getTargetX()).toBeCloseTo(-700, 0);
    expect(physics.getTargetY()).toBeCloseTo(100, 0);
    expect(isSuspended(manager)).toBe(true);
    manager.destroy();
  });

  it("break-off flies the ship toward the planet (disengages the orbit), not the enemy", () => {
    const planet = { x: -1200, y: 1200 };
    const enemy = { x: 600, y: 0 };

    function run(breakOff: boolean): { toPlanet: number; toEnemy: number } {
      const { manager, physics, target } = makeManager();
      target.x = enemy.x;
      target.y = enemy.y;
      target.container.rotation = 0;
      if (breakOff) manager.breakOffCombatPursuit();
      physics.setTarget(planet.x, planet.y);
      for (let f = 0; f < 100; f++) {
        physics.update(50);
        manager.updateCombat(50);
        // Enemy holds station (so closing on it is purely the ship's doing).
        target.x = enemy.x;
        target.y = enemy.y;
        target.container.rotation = 0;
      }
      const toPlanet = Math.hypot(
        physics.shipX - planet.x,
        physics.shipY - planet.y,
      );
      const toEnemy = Math.hypot(
        physics.shipX - enemy.x,
        physics.shipY - enemy.y,
      );
      manager.destroy();
      return { toPlanet, toEnemy };
    }

    const initialToPlanet = Math.hypot(planet.x, planet.y); // ≈1697
    const initialToEnemy = Math.hypot(enemy.x, enemy.y); // 600

    const broke = run(true);
    const pinned = run(false);

    // With break-off the ship closes substantially on the planet and moves AWAY
    // from the enemy it was orbiting.
    expect(broke.toPlanet).toBeLessThan(initialToPlanet - 500);
    expect(broke.toEnemy).toBeGreaterThan(initialToEnemy);

    // Without break-off it stays pinned on the enemy (closes on it) and never
    // makes that progress toward the planet.
    expect(pinned.toEnemy).toBeLessThan(initialToEnemy);
    expect(broke.toPlanet).toBeLessThan(pinned.toPlanet);
  });

  it("break-off self-clears once the route completes, so combat re-engages", () => {
    const { manager, physics, target } = makeManager();
    // Enemy out of range on +y; a short aligned player route straight ahead (+x).
    target.x = 0;
    target.y = 500;
    target.container.rotation = Math.PI / 2; // heading +y
    manager.breakOffCombatPursuit();
    physics.setTarget(40, 0);

    // Fly until the short route completes, then a few frames past arrival.
    for (let f = 0; f < 120; f++) {
      physics.update(50);
      manager.updateCombat(50);
      target.x = 0;
      target.y = 500;
      target.container.rotation = Math.PI / 2;
    }

    // The override cleared on arrival and the pursuit re-engaged toward the
    // still-in-the-fight enemy on +y (so the ship is steering back at it).
    expect(isSuspended(manager)).toBe(false);
    expect(physics.getTargetY()).toBeGreaterThan(0);
    manager.destroy();
  });
});
