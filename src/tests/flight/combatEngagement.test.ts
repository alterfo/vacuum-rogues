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

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms — one "ход"
const PULSE_DAMAGE = 14; // wpn_pulse, range 240

function makeNpc(
  id: string,
  opts: { hull?: number; damage?: number } = {},
): NpcShip {
  const hull = opts.hull ?? 100;
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND, // garrison → turns aggressive in a hostile system
    role: NpcRole.PATROL,
    hullHP: hull,
    maxHull: hull,
    shields: 0,
    speed: 0.1,
    damage: opts.damage ?? 20,
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
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & { x: number; y: number };
}

function makeArena(
  opts: { playerHull?: number; npcHull?: number; npcDamage?: number } = {},
): {
  manager: NpcShipManager;
  combat: CombatModule;
  ship: { hullHP: number; maxHull: number };
  npc: NpcShip;
  sprite: NpcShipSprite & { x: number; y: number };
  physics: ShipPhysics;
  destroyed: NpcShipSprite[];
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const npc = makeNpc("ov_1", {
    hull: opts.npcHull ?? 100,
    damage: opts.npcDamage ?? 20,
  });
  const galaxy = {
    npcShips: [npc],
    isHostileSystem: (id: string) => id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const physics = new ShipPhysics(0, 0, 0.3); // parked at origin

  const playerHull = opts.playerHull ?? 1000;
  const ship = { hullHP: playerHull, maxHull: playerHull };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // dmg 14, range 240
  const destroyed: NpcShipSprite[] = [];

  const combat = new CombatModule({
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    onNpcDestroyed: (s) => destroyed.push(s),
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
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  manager.initialize();
  manager.checkGarrisonAggro("sys_a", true);
  const sprite = spriteOf(manager);
  return { manager, combat, ship, npc, sprite, physics, destroyed };
}

describe("In-flight combat engagement (Task 2)", () => {
  it("an aggressor within weapon range reliably enters combat via the manager", () => {
    const { manager, combat, sprite } = makeArena();
    sprite.x = 100; // within weaponRange (240) of the player at the origin
    sprite.y = 0;

    manager.update(16, 0);

    expect(combat.isActive).toBe(true);
    expect(combat.combatants.has(sprite)).toBe(true);
    expect(combat.selectedTarget).toBe(sprite); // auto-selected
    manager.destroy();
  });

  it("does not engage while the aggressor is still beyond weapon range", () => {
    const { manager, combat, sprite } = makeArena();
    sprite.x = GAME_BALANCE.weaponRange + 300; // outside firing range, within scanner
    sprite.y = 0;

    manager.update(16, 0);

    expect(combat.isActive).toBe(false);
    expect(combat.combatants.size).toBe(0);
    manager.destroy();
  });

  it("stays engaged while orbiting at range over many frames", () => {
    const { manager, combat, sprite, physics } = makeArena();
    sprite.x = 100;
    sprite.y = 0;
    manager.update(16, 0); // engage
    expect(combat.isActive).toBe(true);

    for (let i = 0; i < 80; i++) {
      manager.update(50, 0);
      combat.update(50);
    }

    expect(combat.isActive).toBe(true);
    expect(combat.combatants.has(sprite)).toBe(true);
    const d = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
    expect(d).toBeGreaterThan(6); // orbiting, not overlapping/ramming the player
    expect(d).toBeLessThanOrEqual(GAME_BALANCE.scannerRange); // never disengaged
    manager.destroy();
  });

  it("both ships fire exactly once per turn — N turns deal N shots each", () => {
    const N = 3;
    const { manager, combat, ship, npc, sprite } = makeArena({
      playerHull: 1000,
      npcHull: 100,
      npcDamage: 20,
    });
    sprite.x = 100;
    sprite.y = 0;
    manager.update(16, 0); // engage (no shots fired by engaging)
    expect(ship.hullHP).toBe(1000);
    expect(npc.hullHP).toBe(100);

    sprite.x = 100;
    sprite.y = 0;
    for (let i = 0; i < N; i++) combat.update(FIRE);

    expect(ship.hullHP).toBe(1000 - 20 * N); // NPC fired N shots at the player
    expect(npc.hullHP).toBe(100 - PULSE_DAMAGE * N); // player fired N shots
    expect(ship.hullHP).toBeLessThan(1000); // hull decreased on both sides
    expect(npc.hullHP).toBeLessThan(100);
    manager.destroy();
  });

  it("does not double-fire within a single turn (sub-interval updates)", () => {
    const { manager, combat, ship, sprite } = makeArena({
      playerHull: 1000,
      npcDamage: 20,
    });
    sprite.x = 100;
    sprite.y = 0;
    manager.update(16, 0); // engage
    sprite.x = 100;
    sprite.y = 0;

    combat.update(FIRE / 2);
    expect(ship.hullHP).toBe(1000); // half a turn — no shot yet

    combat.update(FIRE / 2);
    expect(ship.hullHP).toBe(1000 - 20); // exactly one shot at the turn boundary
    manager.destroy();
  });
});
