import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
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

  it("sizes newly spawned sprites' hit areas for the current camera zoom", () => {
    const { manager } = makeHarness([makeNpc("npc_zoom")]);

    // Player is zoomed out BEFORE the ship spawns (system entry / hyperjump
    // arrival). Without spawn-time compensation the sprite keeps its default
    // 40-world-px circle (~10 screen px at MIN_ZOOM) until the next camera
    // transform — near-unhoverable (playtest2 ②).
    manager.updateHitAreas(0.25);
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{ container: { hitArea: { radius: number } } }>;
      }
    ).npcSprites[0];
    // max(28, 40 / 0.25) = 160 world px ≈ 40 screen px at zoom 0.25.
    expect(sprite.container.hitArea.radius).toBeCloseTo(160);

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

  it("a chase course leads ahead of a moving NPC's current position (playtest4 C)", () => {
    // Ship at origin closing faster (0.3) than the NPC drifts (npcSpeed 0.2),
    // NPC far to the right (> weapon range) heading straight +y. The chase must
    // aim AHEAD of the NPC along its heading, not at its current position.
    const physics = new ShipPhysics(0, 0, 0.3);
    const routeCalls: Array<{ x: number; y: number }> = [];

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;
    const galaxy = { npcShips: [makeNpc("npc_chase", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a", ship: { maxHull: 100, hullHP: 100 } },
    } as unknown as GameEngine;
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: (x, y) => routeCalls.push({ x, y }),
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
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          x: number;
          y: number;
          container: { rotation: number };
        }>;
      }
    ).npcSprites[0];
    sprite.x = 500;
    sprite.y = 0;
    sprite.container.rotation = Math.PI / 2; // heading +y (drifting downward)

    manager.followNpcId = "npc_chase";
    manager.updateCombat(1 / 60);

    expect(routeCalls.length).toBe(1);
    const lead = routeCalls[0];
    // Lead is ahead of the NPC along its heading (+y), not at its current y=0.
    expect(lead.y).toBeGreaterThan(sprite.y);
    expect(lead.x).toBeCloseTo(sprite.x, 5);

    manager.destroy();
  });

  it("trader sprite has orbit anchor set to a planet position (wiring)", () => {
    const fakePlanet = { screenX: 800, screenY: 300, displayRadius: 50 };

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;
    const galaxy = {
      npcShips: [makeNpc("trader_wiring", NpcRole.TRADER)],
    } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [
        fakePlanet as unknown as import("@/presentation/PlanetSprite").PlanetSprite,
      ],
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
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{ anchorX: number | null; anchorY: number | null }>;
      }
    ).npcSprites[0];
    expect(sprite.anchorX).toBeCloseTo(800);
    expect(sprite.anchorY).toBeCloseTo(300);

    manager.destroy();
  });

  it("pirate sprite has a deterministic target provider injected by the manager (wiring)", () => {
    const fakePlanet = { screenX: 800, screenY: 300, displayRadius: 50 };

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;
    const galaxy = {
      npcShips: [makeNpc("pirate_wiring", NpcRole.PIRATE)],
    } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [
        fakePlanet as unknown as import("@/presentation/PlanetSprite").PlanetSprite,
      ],
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
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          targetProvider: ((seq: number) => { x: number; y: number }) | null;
        }>;
      }
    ).npcSprites[0];

    // Provider must be set (not null) so pickNewTarget uses role-driven logic.
    expect(sprite.targetProvider).not.toBeNull();

    // Provider is deterministic: same seq → same position.
    const pos0a = sprite.targetProvider!(0);
    const pos0b = sprite.targetProvider!(0);
    expect(pos0a.x).toBe(pos0b.x);
    expect(pos0a.y).toBe(pos0b.y);

    // Different seq values produce different positions.
    const pos1 = sprite.targetProvider!(1);
    expect(pos0a.x === pos1.x && pos0a.y === pos1.y).toBe(false);

    manager.destroy();
  });

  it("patrol sprite target provider returns planet-anchored patrol_station targets", () => {
    const fakePlanet1 = { screenX: 700, screenY: 300, displayRadius: 50 };
    const fakePlanet2 = { screenX: 400, screenY: 900, displayRadius: 50 };

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;
    const galaxy = {
      npcShips: [makeNpc("patrol_wiring", NpcRole.PATROL)],
    } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () =>
        [
          fakePlanet1,
          fakePlanet2,
        ] as unknown as import("@/presentation/PlanetSprite").PlanetSprite[],
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
    manager.initialize();

    // Patrol also has orbit anchor set to a planet (orbit behavior takes priority
    // over the target provider for patrols, same as traders).
    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          anchorX: number | null;
          anchorY: number | null;
          targetProvider: ((seq: number) => { x: number; y: number }) | null;
        }>;
      }
    ).npcSprites[0];

    // Anchor is set to one of the planets.
    const anchorIsAPlanet =
      (sprite.anchorX === fakePlanet1.screenX &&
        sprite.anchorY === fakePlanet1.screenY) ||
      (sprite.anchorX === fakePlanet2.screenX &&
        sprite.anchorY === fakePlanet2.screenY);
    expect(anchorIsAPlanet).toBe(true);

    // Provider is also set as a deterministic fallback.
    expect(sprite.targetProvider).not.toBeNull();

    manager.destroy();
  });
});
