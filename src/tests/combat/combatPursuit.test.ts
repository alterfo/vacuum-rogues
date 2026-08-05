import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

const WR = GAME_BALANCE.weaponRange; // 240

function renderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function makeNpc(id: string, role: NpcRole, faction: Faction): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction,
    role,
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
  aggressive: boolean;
  container: { rotation: number };
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & {
    x: number;
    y: number;
    aggressive: boolean;
    container: { rotation: number };
  };
}

describe("Real-time mutual pursuit during combat (Task 3)", () => {
  it("an engaged player auto-tracks the target and closes the gap each tick", () => {
    const physics = new ShipPhysics(0, 0, 0.5);
    const routeCalls: Array<{ x: number; y: number }> = [];

    const galaxy = {
      npcShips: [makeNpc("trd_1", NpcRole.TRADER, Faction.INDEPENDENT)],
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
        physics.setTarget(x, y); // the scene plumbs the route into physics
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
    target.x = 600; // far outside weapon range (240)
    target.y = 0;
    target.container.rotation = Math.PI; // heading toward the player (no overshoot)

    const startDist = Math.hypot(
      target.x - physics.shipX,
      target.y - physics.shipY,
    );
    let prevDist = startDist;
    let closedEarly = false;
    for (let i = 0; i < 200; i++) {
      manager.updateCombat(100);
      physics.update(100);
      const d = Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
      if (i < 5) expect(d).toBeLessThanOrEqual(prevDist + 1e-6); // closing each tick
      if (i === 5 && d < startDist) closedEarly = true;
      prevDist = d;
    }

    const finalDist = Math.hypot(
      target.x - physics.shipX,
      target.y - physics.shipY,
    );
    expect(routeCalls.length).toBeGreaterThan(0); // auto-tracked without a manual Ход
    expect(closedEarly).toBe(true); // gap shrank within the first few ticks
    expect(finalDist).toBeLessThan(startDist); // closed the gap overall
    expect(finalDist).toBeLessThanOrEqual(WR); // reached and holds weapon range
    manager.destroy();
  });

  it("a player-engaged enemy stays aggressive across the garrison gate and reaches weapon range", () => {
    const physics = new ShipPhysics(0, 0, 0.3); // parked player at the origin

    const npc = makeNpc("trd_1", NpcRole.TRADER, Faction.INDEPENDENT);
    const galaxy = {
      npcShips: [npc],
      isHostileSystem: () => false, // neutral system
    } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const combat = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => {
        const l = new ShipLoadout("hull_warden");
        l.install("wpn_pulse");
        return l;
      },
      getPlayerShip: () => ({ hullHP: 1000, maxHull: 1000 }),
      onNpcDestroyed: () => {},
      showMessage: () => {},
    });

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: (s) => combat.addCombatant(s),
      isInCombat: () => combat.isActive,
      selectCombatTarget: (s) => combat.selectTarget(s),
      getCombatTargetId: () => combat.selectedTarget?.npc.id ?? null,
      isCombatant: (s) => combat.combatants.has(s),
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
    const sprite = spriteOf(manager);
    sprite.x = WR + 300; // outside weapon range
    sprite.y = 0;
    expect(sprite.aggressive).toBe(false); // a neutral trader isn't an aggressor

    (
      manager as unknown as { launchCombatWithNpc(n: NpcShip): void }
    ).launchCombatWithNpc(npc);
    expect(sprite.aggressive).toBe(true); // engaging makes it an aggressor
    expect(combat.combatants.has(sprite as unknown as NpcShipSprite)).toBe(
      true,
    );

    manager.checkGarrisonAggro("sys_a", false);
    expect(sprite.aggressive).toBe(true);

    for (let i = 0; i < 120; i++) manager.update(100, 0);

    const dist = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
    expect(sprite.aggressive).toBe(true); // still pursuing
    expect(dist).toBeLessThanOrEqual(WR); // closed to weapon range
    manager.destroy();
  });
});
