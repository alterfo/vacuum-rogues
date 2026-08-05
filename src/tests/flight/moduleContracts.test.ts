import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Container } from "pixi.js";

vi.mock("@/presentation/PlanetSprite", async () => {
  const { Container: PixiContainer, Graphics } = await import("pixi.js");
  return {
    PlanetSprite: class {
      planet: unknown;
      screenX = 100;
      screenY = 200;
      displayRadius = 60;
      container = new PixiContainer();
      graphics = new Graphics();
      constructor(planet: unknown) {
        this.planet = planet;
      }
      createHitArea(): void {}
      setTooltipHandlers(): void {}
      setOrbitForDay(): void {}
      update(): void {}
      destroy(): void {
        this.container.parent?.removeChild(this.container);
        this.container.destroy({ children: true });
      }
    },
  };
});

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: class {
    container = { addChild: (): void => {} };
    destroy(): void {}
  },
}));

import type { FlightModule } from "@/presentation/flight/FlightModule";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { Planet } from "@/domain/Planet";
import type { ShipPhysics as ShipPhysicsType } from "@/systems/ShipPhysics";

import {
  SpaceBackgroundLayer,
  type BackgroundCamera,
  type BackgroundShipVelocity,
} from "@/presentation/SpaceBackgroundLayer";
import { StarRenderer } from "@/presentation/flight/StarRenderer";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import { OrbitRenderer } from "@/presentation/flight/OrbitRenderer";
import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
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

function makePlanet(id: string): Planet {
  return { id, name: id.toUpperCase() } as unknown as Planet;
}

function makeRenderer(
  gameLayer: Container,
  uiLayer: Container,
  stage: Container,
): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;
}

interface Harness {
  module: FlightModule;
  gameLayer: Container;
}

const MODULE_FACTORIES: { name: string; make: () => Harness }[] = [
  {
    name: "SpaceBackgroundLayer",
    make: () => {
      const stage = new Container();
      const uiLayer = new Container();
      const gameLayer = new Container();
      const skyContainer = new Container();
      stage.addChild(skyContainer);
      const renderer = makeRenderer(gameLayer, uiLayer, stage);
      const camera: BackgroundCamera = { panX: 0, panY: 0, zoom: 1 };
      const velocity: BackgroundShipVelocity = { angle: 0, speed: 0 };
      const module = new SpaceBackgroundLayer(
        renderer,
        skyContainer,
        "sys_a",
        () => camera,
        () => velocity,
      );
      return { module, gameLayer };
    },
  },
  {
    name: "StarRenderer",
    make: () => {
      const gameLayer = new Container();
      const renderer = makeRenderer(
        gameLayer,
        new Container(),
        new Container(),
      );
      const module = new StarRenderer(renderer, null, gameLayer);
      return { module, gameLayer };
    },
  },
  {
    name: "AsteroidBelt",
    make: () => {
      const gameLayer = new Container();
      const renderer = makeRenderer(
        gameLayer,
        new Container(),
        new Container(),
      );
      const module = new AsteroidBelt(renderer, gameLayer);
      return { module, gameLayer };
    },
  },
  {
    name: "OrbitRenderer",
    make: () => {
      const gameLayer = new Container();
      const renderer = makeRenderer(
        gameLayer,
        new Container(),
        new Container(),
      );
      const module = new OrbitRenderer(renderer, gameLayer, null, "sys_a");
      return { module, gameLayer };
    },
  },
  {
    name: "PlayerShipRenderer",
    make: () => {
      const gameLayer = new Container();
      const renderer = makeRenderer(
        gameLayer,
        new Container(),
        new Container(),
      );
      const physics = new ShipPhysics(100, 200, 0.1);
      const module = new PlayerShipRenderer(renderer, gameLayer, physics);
      return { module, gameLayer };
    },
  },
  {
    name: "NpcShipManager",
    make: () => {
      const stage = new Container();
      const uiLayer = new Container();
      const gameLayer = new Container();
      const renderer = makeRenderer(gameLayer, uiLayer, stage);
      const galaxy = { npcShips: [makeNpc("npc_1")] } as unknown as Galaxy;
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
      const module = new NpcShipManager(
        renderer,
        gameEngine,
        gameLayer,
        uiLayer,
        deps,
      );
      return { module, gameLayer };
    },
  },
  {
    name: "PlanetManager",
    make: () => {
      const gameLayer = new Container();
      const uiLayer = new Container();
      const renderer = makeRenderer(gameLayer, uiLayer, new Container());
      const planets = [makePlanet("pa"), makePlanet("pb")];
      const gameEngine = {
        player: { currentSystemId: "sys_a" },
        galaxy: {
          gameDays: 0,
          systems: [
            { id: "sys_a", planets, stations: [], ownerFaction: "INDEPENDENT" },
          ],
        },
        questManager: { getActiveQuestLocations: () => [] },
      } as unknown as GameEngine;
      const deps: PlanetManagerDeps = {
        getShipPhysics: () =>
          ({ shipX: 0, shipY: 0 }) as unknown as ShipPhysicsType,
        getStarCenter: () => ({ x: 400, y: 300 }),
        isTurnRunning: () => false,
        getOrbitalDay: () => 0,
        showPlanetTooltip: () => {},
        hideTooltip: () => {},
        clearFollow: () => {},
      };
      const module = new PlanetManager(
        renderer,
        gameEngine,
        gameLayer,
        uiLayer,
        deps,
      );
      return { module, gameLayer };
    },
  },
  {
    name: "FlightHud",
    make: () => {
      const gameLayer = new Container();
      const uiLayer = new Container();
      const renderer = makeRenderer(gameLayer, uiLayer, new Container());
      const gameEngine = {
        galaxy: { gameDays: 0 },
        audio: {
          playUiClick: () => {},
          playUiHover: () => {},
          playToast: () => {},
        },
        questManager: {},
        player: { getReputation: () => 0 },
      } as unknown as GameEngine;
      const module = new FlightHud(renderer, gameEngine, uiLayer);
      return { module, gameLayer };
    },
  },
];

describe.each(MODULE_FACTORIES)("FlightModule contract: $name", ({ make }) => {
  it("runs initialize → update → destroy without throwing", () => {
    const { module } = make();
    expect(() => {
      module.initialize();
      module.update(1 / 60, 100);
      module.destroy();
    }).not.toThrow();
  });

  it("leaks no display objects on the game layer after destroy()", () => {
    const { module, gameLayer } = make();
    module.initialize();
    module.update(1 / 60, 100);
    module.destroy();
    expect(gameLayer.children.length).toBe(0);
  });

  it("survives a destroy() with no prior initialize() (defensive teardown)", () => {
    const { module } = make();
    expect(() => module.destroy()).not.toThrow();
  });
});

describe("SpaceFlightScene size guard", () => {
  const MAX_LINES = 1900;

  it(`keeps SpaceFlightScene.ts under ${MAX_LINES} lines (was 5200+)`, () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const scenePath = resolve(here, "../../presentation/SpaceFlightScene.ts");
    const lineCount = readFileSync(scenePath, "utf8").split("\n").length;

    expect(lineCount).toBeLessThan(MAX_LINES);
    expect(lineCount).toBeLessThan(5200);
  });
});
