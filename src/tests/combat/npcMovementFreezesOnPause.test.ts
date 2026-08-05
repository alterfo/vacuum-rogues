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
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & {
    x: number;
    y: number;
    aggressive: boolean;
  };
}

describe("Active pause freezes NPC ship movement (Task 1)", () => {
  it("an engaged enemy on a live pursuit course stops moving while paused, resumes on unpause", () => {
    const physics = new ShipPhysics(0, 0, 0.3); // parked player at the origin
    let paused = false;

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
      isPaused: () => paused,
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
    sprite.x = WR + 300; // outside weapon range, so it actively closes in
    sprite.y = 0;

    (
      manager as unknown as { launchCombatWithNpc(n: NpcShip): void }
    ).launchCombatWithNpc(npc);
    expect(sprite.aggressive).toBe(true);

    const before = { x: sprite.x, y: sprite.y };
    for (let i = 0; i < 5; i++) manager.update(100, 0);
    expect(
      Math.hypot(sprite.x - before.x, sprite.y - before.y),
    ).toBeGreaterThan(0);

    paused = true;
    const frozen = { x: sprite.x, y: sprite.y };
    for (let i = 0; i < 10; i++) manager.update(100, 0);
    expect(sprite.x).toBe(frozen.x);
    expect(sprite.y).toBe(frozen.y);

    paused = false;
    for (let i = 0; i < 5; i++) manager.update(100, 0);
    expect(
      Math.hypot(sprite.x - frozen.x, sprite.y - frozen.y),
    ).toBeGreaterThan(0);

    manager.destroy();
  });

  it("freezes NPC-vs-NPC crossfire while paused (no damage, no backed-up volley on unpause)", () => {
    const physics = new ShipPhysics(0, 0, 0.3);
    let paused = false;

    const drone = makeNpc("ovm_drone", NpcRole.PATROL, Faction.OVERMIND);
    const pirate = makeNpc("prt_1", NpcRole.PIRATE, Faction.INDEPENDENT);
    const galaxy = {
      npcShips: [drone, pirate],
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
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: () => {},
      isInCombat: () => false,
      selectCombatTarget: () => {},
      getCombatTargetId: () => null,
      isCombatant: () => false,
      isPaused: () => paused,
    };

    const manager = new NpcShipManager(
      renderer(),
      gameEngine,
      new Container(),
      new Container(),
      deps,
    );
    manager.initialize();

    const sprites = (manager as unknown as { npcSprites: NpcShipSprite[] })
      .npcSprites;
    (sprites[0] as unknown as { x: number; y: number }).x = 400;
    (sprites[0] as unknown as { x: number; y: number }).y = 300;
    (sprites[1] as unknown as { x: number; y: number }).x = 420;
    (sprites[1] as unknown as { x: number; y: number }).y = 300;

    const mgr = manager as unknown as {
      resolveNpcVsNpcCombat(dt: number): void;
      npcCrossfireTimer: number;
    };
    const hull0 = drone.hullHP;

    paused = true;
    mgr.resolveNpcVsNpcCombat(GAME_BALANCE.combatFireIntervalMs * 3);
    expect(drone.hullHP).toBe(hull0);
    expect(pirate.hullHP).toBe(hull0);
    expect(mgr.npcCrossfireTimer).toBe(0);

    paused = false;
    mgr.resolveNpcVsNpcCombat(GAME_BALANCE.combatFireIntervalMs);
    expect(drone.hullHP).toBeLessThan(hull0);
    expect(pirate.hullHP).toBeLessThan(hull0);

    manager.destroy();
  });
});
