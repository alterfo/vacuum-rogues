import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { GearKind } from "@/systems/equipment/GearCatalog";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipPhysics as RealShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

/** A minimal ShipPhysics stand-in carrying the fields CombatModule touches. */
function makePhysics(): ShipPhysics & {
  isMoving: boolean;
  currentSpeed: number;
} {
  return {
    shipX: 100,
    shipY: 200,
    isMoving: true,
    currentSpeed: 0.1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics & { isMoving: boolean; currentSpeed: number };
}

function makeSprite(id: string): NpcShipSprite {
  return { npc: { id } } as unknown as NpcShipSprite;
}

function makeDeps(physics: ShipPhysics | null): CombatModuleDeps {
  return { getShipPhysics: () => physics };
}

describe("CombatModule skeleton (Task 11)", () => {
  it("initializes without throwing and starts inactive", () => {
    const module = new CombatModule(makeDeps(null));
    expect(() => module.initialize()).not.toThrow();
    expect(module.isActive).toBe(false);
    expect(module.activeTarget).toBeNull();
  });

  it("startCombat activates and stores the target NPC", () => {
    const module = new CombatModule(makeDeps(makePhysics()));
    const sprite = makeSprite("npc_1");
    module.startCombat(sprite);
    expect(module.isActive).toBe(true);
    expect(module.activeTarget).toBe(sprite);
  });

  it("startCombat freezes player movement", () => {
    const physics = makePhysics();
    const module = new CombatModule(makeDeps(physics));
    module.startCombat(makeSprite("npc_1"));
    expect(physics.isMoving).toBe(false);
    expect(physics.currentSpeed).toBe(0);
  });

  it("a second startCombat while active keeps the original target", () => {
    const module = new CombatModule(makeDeps(null));
    const first = makeSprite("npc_1");
    module.startCombat(first);
    module.startCombat(makeSprite("npc_2"));
    expect(module.activeTarget).toBe(first);
  });

  it("does not start (or freeze for) combat when the player has no weapon", () => {
    const physics = makePhysics();
    const loadout = { slottedWithGear: () => [] } as unknown as ShipLoadout;
    const module = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => loadout,
    });
    module.startCombat(makeSprite("npc_1"));
    // Weaponless: combat is skipped so the ship stays free to fly away (no soft-lock).
    expect(module.isActive).toBe(false);
    expect(module.activeTarget).toBeNull();
    expect(physics.isMoving).toBe(true);
  });

  it("starts combat when at least one weapon is equipped", () => {
    const physics = makePhysics();
    const loadout = {
      slottedWithGear: () => [{ gear: { kind: GearKind.WEAPON } }],
    } as unknown as ShipLoadout;
    const module = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => loadout,
    });
    module.startCombat(makeSprite("npc_1"));
    expect(module.isActive).toBe(true);
    expect(physics.isMoving).toBe(false);
  });

  it("endCombat clears the target and deactivates", () => {
    const module = new CombatModule(makeDeps(makePhysics()));
    module.startCombat(makeSprite("npc_1"));
    module.endCombat();
    expect(module.isActive).toBe(false);
    expect(module.activeTarget).toBeNull();
  });

  it("runs the full lifecycle without throwing", () => {
    const module = new CombatModule(makeDeps(makePhysics()));
    expect(() => {
      module.initialize();
      module.update(1 / 60, 100);
      module.startCombat(makeSprite("npc_1"));
      module.update(1 / 60, 100);
      module.endCombat();
      module.destroy();
    }).not.toThrow();
  });

  it("survives destroy() with no prior combat (defensive teardown)", () => {
    const module = new CombatModule(makeDeps(null));
    expect(() => module.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Wiring: an aggressive garrison sprite that reaches attack range of the player
// ship triggers the in-flight combat callback (not a CombatScene transition).
// ---------------------------------------------------------------------------
function makeOvermind(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role: NpcRole.PATROL,
    hullHP: 100,
    maxHull: 100,
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

function aggressiveManager(
  physics: ShipPhysics,
  startInFlightCombat: (sprite: NpcShipSprite) => void,
): NpcShipManager {
  const gameLayer = new Container();
  const uiLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer,
    gameLayer,
  } as unknown as Renderer;
  const galaxy = {
    npcShips: [makeOvermind("ov_1")],
    isHostileSystem: (id: string) => id === "sys_a",
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
    startInFlightCombat,
  };
  return new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps);
}

function spriteList(manager: NpcShipManager): NpcShipSprite[] {
  return (manager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites;
}

describe("NpcShipManager → CombatModule wiring", () => {
  it("calls startInFlightCombat when an aggressive sprite reaches attack range", () => {
    const physics = new RealShipPhysics(0, 0, 0.3);
    let combatTarget: NpcShipSprite | null = null;
    const manager = aggressiveManager(physics, (s) => {
      combatTarget = s;
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", true);

    const sprite = spriteList(manager)[0];
    // Park the aggressor well inside weapon range of the player at (0,0).
    (sprite as unknown as { x: number; y: number }).x = 50;
    (sprite as unknown as { x: number; y: number }).y = 0;

    manager.update(16, 0);

    expect(combatTarget).toBe(sprite);
    manager.destroy();
  });

  it("does not trigger combat for an aggressor still out of range", () => {
    const physics = new RealShipPhysics(0, 0, 0.3);
    let triggered = false;
    const manager = aggressiveManager(physics, () => {
      triggered = true;
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", true);

    const sprite = spriteList(manager)[0];
    // 2000px away — far beyond the 240px weapon range.
    (sprite as unknown as { x: number; y: number }).x = 2000;
    (sprite as unknown as { x: number; y: number }).y = 0;

    manager.update(16, 0);

    expect(triggered).toBe(false);
    manager.destroy();
  });
});
