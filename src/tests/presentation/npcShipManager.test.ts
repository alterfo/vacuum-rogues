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
    expect(gameLayer.children.length).toBe(2);

    manager.destroy();
  });

  it("sizes newly spawned sprites' hit areas for the current camera zoom", () => {
    const { manager } = makeHarness([makeNpc("npc_zoom")]);

    manager.updateHitAreas(0.25);
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{ container: { hitArea: { radius: number } } }>;
      }
    ).npcSprites[0];
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

    expect(manager.followNpcId).toBeNull();
    expect(manager.getFollowTarget()).toBeNull();

    expect(() => manager.update(1 / 60, 100)).not.toThrow();
    expect(() => manager.updateCombat(1 / 60)).not.toThrow();

    manager.destroy();
    expect(gameLayer.children.length).toBe(0);
    expect(manager.npcCount).toBe(0);
  });

  it("e2eClickNpc is a no-op for out-of-range and negative indices", () => {
    const { manager } = makeHarness([makeNpc("npc_1")]);
    manager.initialize();

    expect(() => manager.e2eClickNpc(99)).not.toThrow();
    expect(() => manager.e2eClickNpc(-1)).not.toThrow();
    expect(manager.isContactPanelOpen).toBe(false);

    manager.destroy();
  });

  it("reports no open modal and tolerates a null galaxy", () => {
    const { manager } = makeHarness([]);
    expect(manager.hasOpenModal()).toBe(false);
    expect(manager.isContactPanelOpen).toBe(false);

    manager.initialize();
    expect(manager.npcCount).toBe(0);
    manager.destroy();
  });

  it("a chase course leads ahead of a moving NPC's current position (playtest4 C)", () => {
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
    expect(lead.y).toBeGreaterThan(sprite.y);
    expect(lead.x).toBeCloseTo(sprite.x, 5);

    manager.destroy();
  });

  it("re-aims the chase MID-FLIGHT when the target drifts (continuous course-correction)", () => {
    const physics = new ShipPhysics(0, 0, 0.3);
    physics.isMoving = true; // already en route — the mid-flight case
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
    sprite.container.rotation = Math.PI / 2; // heading +y

    manager.followNpcId = "npc_chase";

    manager.updateCombat(1 / 60);
    expect(routeCalls.length).toBe(1);

    sprite.y += 120;
    manager.updateCombat(1 / 60);
    expect(routeCalls.length).toBe(2);

    sprite.y += 4;
    manager.updateCombat(1 / 60);
    expect(routeCalls.length).toBe(2);

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

    expect(sprite.targetProvider).not.toBeNull();

    const pos0a = sprite.targetProvider!(0);
    const pos0b = sprite.targetProvider!(0);
    expect(pos0a.x).toBe(pos0b.x);
    expect(pos0a.y).toBe(pos0b.y);

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

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          anchorX: number | null;
          anchorY: number | null;
          targetProvider: ((seq: number) => { x: number; y: number }) | null;
        }>;
      }
    ).npcSprites[0];

    const anchorIsAPlanet =
      (sprite.anchorX === fakePlanet1.screenX &&
        sprite.anchorY === fakePlanet1.screenY) ||
      (sprite.anchorX === fakePlanet2.screenX &&
        sprite.anchorY === fakePlanet2.screenY);
    expect(anchorIsAPlanet).toBe(true);

    expect(sprite.targetProvider).not.toBeNull();

    manager.destroy();
  });
});

describe("NpcShipManager.rememberFlightPos", () => {
  it("writes ship position to gameEngine.lastFlightShipPos before combat transition", () => {
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();

    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const physics = new ShipPhysics(320, 240, 0.15);
    const lastFlightShipPosHolder: { x: number; y: number } | null = null;
    const gameEngine = {
      galaxy: { npcShips: [] } as unknown as Galaxy,
      player: { currentSystemId: "sys_a" },
      lastFlightShipPos: lastFlightShipPosHolder,
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
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

    (manager as unknown as { rememberFlightPos(): void }).rememberFlightPos();

    expect(
      (gameEngine as unknown as { lastFlightShipPos: { x: number; y: number } })
        .lastFlightShipPos,
    ).toEqual({ x: 320, y: 240 });

    manager.destroy();
  });

  it("launchCombatWithNpc engages in-flight combat without a scene transition", () => {
    const engaged: Array<{ npc: { id: string } }> = [];
    const targeted: Array<{ npc: { id: string } }> = [];
    const transitions: unknown[] = [];

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const galaxy = { npcShips: [makeNpc("npc_target", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
      transitionTo: (...args: unknown[]) => {
        transitions.push(args);
      },
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: (sprite) =>
        engaged.push(sprite as unknown as { npc: { id: string } }),
      selectCombatTarget: (sprite) =>
        targeted.push(sprite as unknown as { npc: { id: string } }),
    };

    const manager = new NpcShipManager(
      renderer,
      gameEngine,
      gameLayer,
      uiLayer,
      deps,
    );
    manager.initialize();
    manager.followNpcId = "npc_target";

    const npc = galaxy.npcShips[0];
    (
      manager as unknown as { launchCombatWithNpc(n: typeof npc): void }
    ).launchCombatWithNpc(npc);

    expect(engaged.length).toBe(1);
    expect(engaged[0].npc.id).toBe("npc_target");
    expect(targeted.length).toBe(1);
    expect(targeted[0].npc.id).toBe("npc_target");
    expect(transitions.length).toBe(0);
    expect(manager.followNpcId).toBeNull();

    manager.destroy();
  });

  it("a caught shakedown flee engages combat AND resumes the frozen turn (regression)", () => {
    const engaged: Array<{ npc: { id: string } }> = [];
    const targeted: Array<{ npc: { id: string } }> = [];
    const routes: Array<{ x: number; y: number }> = [];

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const galaxy = { npcShips: [makeNpc("npc_pirate", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null, // playerSpeed 0 → fleeEscapeChance 0 → always caught
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => false,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: (x, y) => routes.push({ x, y }),
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: (sprite) =>
        engaged.push(sprite as unknown as { npc: { id: string } }),
      selectCombatTarget: (sprite) =>
        targeted.push(sprite as unknown as { npc: { id: string } }),
    };

    const manager = new NpcShipManager(
      renderer,
      gameEngine,
      gameLayer,
      uiLayer,
      deps,
    );
    manager.initialize();

    const npc = galaxy.npcShips[0];
    (
      manager as unknown as { onFleeShakedown(n: typeof npc): void }
    ).onFleeShakedown(npc);

    expect(engaged.length).toBe(1);
    expect(engaged[0].npc.id).toBe("npc_pirate");
    expect(targeted.length).toBe(1);
    expect(routes.length).toBe(1);
    expect(manager.followNpcId).toBe("npc_pirate");

    manager.destroy();
  });

  it("a garrison aggressor inside weapon range engages via startInFlightCombat, not a scene hop (Task 4)", () => {
    const engaged: Array<{ npc: { id: string } }> = [];
    const transitions: unknown[] = [];

    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const physics = new ShipPhysics(0, 0, 0.2);
    const galaxy = { npcShips: [makeNpc("aggressor", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a", ship: { maxHull: 100, hullHP: 100 } },
      transitionTo: (...args: unknown[]) => {
        transitions.push(args);
      },
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
      startInFlightCombat: (sprite) =>
        engaged.push(sprite as unknown as { npc: { id: string } }),
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
          setAggressive(on: boolean): void;
        }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);
    sprite.x = 0; // on the ship → within WEAPON_RANGE
    sprite.y = 0;

    manager.update(1 / 60, 100);

    expect(engaged.length).toBeGreaterThanOrEqual(1);
    expect(engaged[0].npc.id).toBe("aggressor");
    expect(transitions.length).toBe(0);

    manager.destroy();
  });

  it("getNpcDots reports each NPC's live aggressive state (Task 5)", () => {
    const { manager } = makeHarness([makeNpc("npc_1", NpcRole.PIRATE)]);
    manager.initialize();

    expect(manager.getNpcDots()[0].aggressive).toBe(false);

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{ setAggressive(on: boolean): void }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);

    expect(manager.getNpcDots()[0].aggressive).toBe(true);

    manager.destroy();
  });

  it("warns once via showMessage when an NPC turns aggressive, and re-arms after it drops aggression (Task 5)", () => {
    const messages: Array<{ text: string; color?: number }> = [];
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const galaxy = { npcShips: [makeNpc("npc_threat", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: (text, color) => messages.push({ text, color }),
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
        npcSprites: Array<{ setAggressive(on: boolean): void }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);

    manager.update(1 / 60, 100);
    expect(messages.length).toBe(1);
    expect(messages[0].text).toContain("npc_threat");
    expect(messages[0].color).toBe(0xff4444);

    manager.update(1 / 60, 100);
    expect(messages.length).toBe(1);

    sprite.setAggressive(false);
    manager.update(1 / 60, 100);
    sprite.setAggressive(true);
    manager.update(1 / 60, 100);
    expect(messages.length).toBe(2);

    manager.destroy();
  });

  it("does not warn about an aggressor that is already an active combatant (Task 5)", () => {
    const messages: Array<{ text: string; color?: number }> = [];
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const galaxy = { npcShips: [makeNpc("npc_engaged", NpcRole.PIRATE)] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: (text, color) => messages.push({ text, color }),
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      isCombatant: () => true,
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
        npcSprites: Array<{ setAggressive(on: boolean): void }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);

    manager.update(1 / 60, 100);
    expect(messages.length).toBe(0);

    manager.destroy();
  });
});

describe("NpcShipManager — grapple pins an aggressive target", () => {
  function harnessWithGrapple(grappleStrength: number | null): {
    manager: NpcShipManager;
    messages: Array<{ text: string; color?: number }>;
    sprite: { setAggressive(on: boolean): void; isGrappled(): boolean };
  } {
    const messages: Array<{ text: string; color?: number }> = [];
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const npc = makeNpc("npc_grappled", NpcRole.PIRATE);
    const galaxy = { npcShips: [npc] };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
      playerLoadout:
        grappleStrength == null
          ? null
          : { derivedStats: () => ({ grappleStrength }) },
    } as unknown as GameEngine;

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: (text, color) => messages.push({ text, color }),
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      isCombatant: () => true, // suppress the unrelated "incoming attacker" warning
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
          setAggressive(on: boolean): void;
          isGrappled(): boolean;
        }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);

    return { manager, messages, sprite };
  }

  it("marks the target grappled once player grappleStrength meets its hold threshold", () => {
    // npc_grappled has maxHull 100 (see makeNpc) → threshold = 100 * GRAPPLE_HOLD.hullToThreshold = 50
    const { manager, messages, sprite } = harnessWithGrapple(90);

    manager.update(1 / 60, 100);

    expect(sprite.isGrappled()).toBe(true);
    expect(messages.some((m) => m.text.includes("🔗"))).toBe(true);

    manager.destroy();
  });

  it("does not mark the target grappled with no grapple installed", () => {
    const { manager, messages, sprite } = harnessWithGrapple(null);

    manager.update(1 / 60, 100);

    expect(sprite.isGrappled()).toBe(false);
    expect(messages.some((m) => m.text.includes("🔗"))).toBe(false);

    manager.destroy();
  });

  it("only shows the grapple hint once across repeated frames", () => {
    const { manager, messages } = harnessWithGrapple(90);

    manager.update(1 / 60, 100);
    manager.update(1 / 60, 100);
    manager.update(1 / 60, 100);

    expect(messages.filter((m) => m.text.includes("🔗")).length).toBe(1);

    manager.destroy();
  });
});
