import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
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

const NPC_SPEED = GAME_BALANCE.npcSpeed; // 0.2 px/ms — the aggressor's cruise speed
const ESCAPE = GAME_BALANCE.combatEscapeRange; // 1200 world px

function cruise(maxSpeed: number): ShipPhysics {
  const p = new ShipPhysics(0, 0, maxSpeed);
  p.setTarget(100_000, 0); // far enough never to decelerate during the run-up
  for (let i = 0; i < 200; i++) p.update(50);
  return p;
}

describe("ShipPhysics.canOutrun (Task 3)", () => {
  it("a ship cruising faster than the pursuer out-runs it", () => {
    const fast = cruise(0.5);
    expect(fast.currentSpeed).toBeGreaterThan(NPC_SPEED);
    expect(fast.canOutrun(NPC_SPEED)).toBe(true);
  });

  it("a ship at equal cruise speed does NOT out-run the pursuer", () => {
    const equal = cruise(NPC_SPEED);
    expect(equal.currentSpeed).toBeCloseTo(NPC_SPEED, 6);
    expect(equal.canOutrun(NPC_SPEED)).toBe(false);
  });

  it("a slower ship does NOT out-run the pursuer", () => {
    const slow = cruise(0.1);
    expect(slow.canOutrun(NPC_SPEED)).toBe(false);
  });

  it("a parked ship out-runs no one even with a fast engine", () => {
    const parked = new ShipPhysics(0, 0, 0.6); // never given a route → not moving
    expect(parked.isMoving).toBe(false);
    expect(parked.canOutrun(NPC_SPEED)).toBe(false);
  });
});

function fakeSprite(x: number, y: number): NpcShipSprite {
  return {
    x,
    y,
    npc: { id: "s", name: "s", hullHP: 100, maxHull: 100, damage: 20 },
  } as unknown as NpcShipSprite;
}

function combatOnly(): { module: CombatModule; physics: ShipPhysics } {
  const physics = new ShipPhysics(0, 0, 0.3); // parked at origin
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  const deps: CombatModuleDeps = {
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ({ hullHP: 1000, maxHull: 1000 }),
    onNpcDestroyed: () => {},
    showMessage: () => {},
  };
  return { module: new CombatModule(deps), physics };
}

describe("CombatModule disengage at escape range (Task 3)", () => {
  it("keeps a combatant the player has NOT opened beyond the escape range", () => {
    const { module } = combatOnly();
    const a = fakeSprite(ESCAPE - 50, 0); // just inside the escape range
    module.addCombatant(a);
    module.update(16);
    expect(module.combatants.has(a)).toBe(true);
    expect(module.isActive).toBe(true);
  });

  it("drops a combatant the player opens beyond the escape range and ends the fight", () => {
    const { module } = combatOnly();
    const a = fakeSprite(ESCAPE + 50, 0); // just outside the escape range
    module.addCombatant(a);
    module.update(16);
    expect(module.combatants.has(a)).toBe(false);
    expect(module.isActive).toBe(false);
  });
});

function makeNpc(id: string, hull: number): NpcShip {
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

function makeArena(playerMaxSpeed: number): {
  manager: NpcShipManager;
  combat: CombatModule;
  sprite: NpcShipSprite & { x: number; y: number; aggressive: boolean };
  physics: ShipPhysics;
} {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const npc = makeNpc("ov_1", 100_000); // effectively unkillable for the test window
  const galaxy = {
    npcShips: [npc],
    isHostileSystem: (id: string) => id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const physics = new ShipPhysics(0, 0, playerMaxSpeed); // parked at origin
  const ship = { hullHP: 1_000_000, maxHull: 1_000_000 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");

  const combat = new CombatModule({
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
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
  sprite.x = 100; // within weapon range of the parked player at the origin
  sprite.y = 0;
  return { manager, combat, sprite, physics };
}

function flee(arena: ReturnType<typeof makeArena>, frames: number): void {
  const { manager, combat, physics } = arena;
  manager.update(16, 0); // first frame: aggressor engages at range
  expect(combat.isActive).toBe(true);
  physics.setTarget(-100_000, 0); // run straight away from the aggressor
  for (let i = 0; i < frames; i++) {
    physics.update(50);
    manager.update(50, 0);
    combat.update(50);
  }
}

describe("In-flight combat escape (Task 3)", () => {
  it("a faster player out-runs a slower pursuer — the fight ends", () => {
    const arena = makeArena(0.6); // 0.6 > npcSpeed 0.2 → can out-run
    flee(arena, 400);
    expect(arena.combat.isActive).toBe(false); // escaped → fight over
    expect(arena.sprite.aggressive).toBe(false); // aggressor broke off the chase
  });

  it("a slower player can NOT escape — stays engaged", () => {
    const arena = makeArena(0.1); // 0.1 < npcSpeed 0.2 → caught
    flee(arena, 400);
    expect(arena.combat.isActive).toBe(true);
    expect(arena.sprite.aggressive).toBe(true); // never broke off
    const d = Math.hypot(
      arena.sprite.x - arena.physics.shipX,
      arena.sprite.y - arena.physics.shipY,
    );
    expect(d).toBeLessThanOrEqual(ESCAPE); // never opened past the escape range
  });

  it("an equal-speed player can NOT escape — stays engaged", () => {
    const arena = makeArena(NPC_SPEED); // exactly matched → pursuit holds
    flee(arena, 400);
    expect(arena.combat.isActive).toBe(true);
    expect(arena.sprite.aggressive).toBe(true);
  });

  it("re-planning a route mid-fight keeps the ship moving while combat continues", () => {
    const arena = makeArena(0.1); // slow → fight persists so we can observe motion
    arena.manager.update(16, 0); // engage
    expect(arena.combat.isActive).toBe(true);

    arena.physics.setTarget(-5000, 1500);
    const startX = arena.physics.shipX;
    const startY = arena.physics.shipY;
    for (let i = 0; i < 40; i++) {
      arena.physics.update(50);
      arena.manager.update(50, 0);
      arena.combat.update(50);
    }
    expect(arena.physics.isMoving).toBe(true);
    const moved = Math.hypot(
      arena.physics.shipX - startX,
      arena.physics.shipY - startY,
    );
    expect(moved).toBeGreaterThan(50); // the new route was flown
    expect(arena.combat.isActive).toBe(true); // and the fight is still on
  });
});
