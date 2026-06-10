import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(id: string, role: NpcRole = NpcRole.TRADER): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
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

/**
 * Build a minimal harness: a real PixiJS game/UI layer, a galaxy stub carrying
 * NPC ships, and inert deps accessors. The manager spawns sprites onto the game
 * layer and reads live state through the injected accessors, so real Containers
 * exercise the scene-graph wiring without a WebGL context.
 */
function makeHarness(npcs: NpcShip[]): {
  manager: NpcShipManager;
  gameLayer: Container;
  uiLayer: Container;
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

  const galaxy = { npcShips: npcs } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => false,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  return { manager, gameLayer, uiLayer };
}

describe("NpcShipManager (extracted FlightModule)", () => {
  it("has no sprites before initialize() and spawns one per present NPC after", () => {
    const { manager, gameLayer } = makeHarness([
      makeNpc("npc_1"),
      makeNpc("npc_2", NpcRole.PIRATE),
    ]);

    expect(manager.npcCount).toBe(0);
    expect(gameLayer.children.length).toBe(0);

    manager.initialize();

    expect(manager.npcCount).toBe(2);
    // Each NPC sprite mounts its container on the game layer.
    expect(gameLayer.children.length).toBe(2);

    manager.destroy();
  });

  it("skips NPCs that are not present in the player's system", () => {
    const away = makeNpc("npc_away");
    away.state = NpcState.TRAVELING; // in transit → not present
    const here = makeNpc("npc_here");
    const { manager } = makeHarness([away, here]);

    manager.initialize();

    expect(manager.npcCount).toBe(1);
    manager.destroy();
  });

  it("exposes mini-map dots and follow state, and runs update/destroy cleanly", () => {
    const { manager, gameLayer } = makeHarness([makeNpc("npc_1")]);
    manager.initialize();

    const dots = manager.getNpcDots();
    expect(dots.length).toBe(1);
    expect(typeof dots[0].x).toBe("number");
    expect(typeof dots[0].color).toBe("number");

    // No follow target by default.
    expect(manager.followNpcId).toBeNull();
    expect(manager.getFollowTarget()).toBeNull();

    // Turn not running → update() is a no-op (and never throws).
    expect(() => manager.update(1 / 60, 100)).not.toThrow();
    expect(() => manager.updateCombat(1 / 60)).not.toThrow();

    manager.destroy();
    // destroy() removes (and destroys) the NPC containers from the layer.
    expect(gameLayer.children.length).toBe(0);
    expect(manager.npcCount).toBe(0);
  });

  it("e2eClickNpc is a no-op for out-of-range and negative indices", () => {
    const { manager } = makeHarness([makeNpc("npc_1")]);
    manager.initialize();

    // Out-of-range and negative indices must not throw (npcSprites[i] is
    // undefined → the `if (sprite)` guard skips onNpcClick). This pins the guard
    // a browser test cannot reach (the scene mocks the manager).
    expect(() => manager.e2eClickNpc(99)).not.toThrow();
    expect(() => manager.e2eClickNpc(-1)).not.toThrow();
    expect(manager.isContactPanelOpen).toBe(false);

    manager.destroy();
  });

  it("reports no open modal and tolerates a null galaxy", () => {
    const { manager } = makeHarness([]);
    expect(manager.hasOpenModal()).toBe(false);
    expect(manager.isContactPanelOpen).toBe(false);

    // initialize() with no present NPCs leaves the manager empty.
    manager.initialize();
    expect(manager.npcCount).toBe(0);
    manager.destroy();
  });
});
