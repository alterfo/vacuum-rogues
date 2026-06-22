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

// ---------------------------------------------------------------------------
// Task 3: Automatic mutual pursuit during combat.
//
// While a fight is engaged BOTH sides must close the gap on their own — the
// player ship auto-tracks the selected target in real time (no fresh "Ход"),
// and every engaged enemy auto-closes to weapon range and holds it (instead of
// orbiting its planet / drifting). The captured-system garrison gate must not
// clear an active combatant's aggression out from under the fight.
// ---------------------------------------------------------------------------

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

/** Sprites are private; expose the first one for white-box positioning. */
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
    // Player parked at the origin; a fight is engaged against a target sitting
    // well outside weapon range. updateCombat must drive the ship toward it in
    // real time — no manual "Ход" — until it holds weapon range.
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
      // A live fight against trd_1, frozen by nothing.
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
    // A trader in a NEUTRAL system (no garrison aggro of its own). The player
    // attacks it → it becomes an active combatant and must auto-close on the
    // player, holding range — and a later captured-system refresh in the still
    // neutral system must NOT clear its aggression out from under the fight.
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

    // Player attacks → engage in-flight combat.
    (
      manager as unknown as { launchCombatWithNpc(n: NpcShip): void }
    ).launchCombatWithNpc(npc);
    expect(sprite.aggressive).toBe(true); // engaging makes it an aggressor
    expect(combat.combatants.has(sprite as unknown as NpcShipSprite)).toBe(
      true,
    );

    // A captured-system refresh in the STILL-neutral system must not stand the
    // combatant down (the regression — without the engaged-combatant exemption
    // this clears aggression and the enemy stops chasing).
    manager.checkGarrisonAggro("sys_a", false);
    expect(sprite.aggressive).toBe(true);

    // It now auto-closes on the parked player and reaches weapon range.
    for (let i = 0; i < 120; i++) manager.update(100, 0);

    const dist = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
    expect(sprite.aggressive).toBe(true); // still pursuing
    expect(dist).toBeLessThanOrEqual(WR); // closed to weapon range
    manager.destroy();
  });
});
