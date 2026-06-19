/**
 * Task 1 (font-scale restyle in place): a font-size change must restyle the
 * text-bearing flight modules WITHOUT a scene re-init. The guarantee under test
 * is "the world is left untouched": planet/asteroid/ship sprites (which live on
 * the game layer) keep their exact instances across `refreshFontScale()`, while
 * the modules' text labels pick up the new `scaledFont` size.
 *
 * Built against a REAL PixiJS scene graph (Container / Graphics / Text construct
 * in jsdom without WebGL). PlanetSprite / PlanetInfoPanel need WebGL textures in
 * real play, so they are stubbed with lightweight stand-ins (mirroring
 * moduleContracts.test.ts) — the assertions are about object identity + font
 * size, which the stubs preserve.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Container, Text } from "pixi.js";

// Lightweight PlanetSprite/PlanetInfoPanel stand-ins (real WebGL textures aren't
// available in jsdom). Their `container` is a real PixiJS Container so the
// manager's mount/teardown flows through the real scene graph.
import { vi } from "vitest";
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

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import type { ShipPhysics as ShipPhysicsType } from "@/systems/ShipPhysics";
import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { formatGameDate } from "@/utils/gameCalendar";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

function makeRenderer(gameLayer: Container, uiLayer: Container): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer,
    gameLayer,
  } as unknown as Renderer;
}

function makePlanet(id: string): Planet {
  return { id, name: id.toUpperCase() } as unknown as Planet;
}

function makeStation(id: string): Station {
  return {
    id,
    name: id.toUpperCase(),
    type: "TRADE_POST",
    orbitAngle: 0.5,
    orbitRadius: 180,
  } as unknown as Station;
}

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

/** Recursively collect every PixiJS Text node under a display object. */
function allTexts(node: Container): Text[] {
  const out: Text[] = [];
  if (node instanceof Text) out.push(node);
  for (const child of node.children) {
    if (child instanceof Container) out.push(...allTexts(child));
  }
  return out;
}

describe("PlanetManager.refreshFontScale", () => {
  function build(): {
    manager: PlanetManager;
    gameLayer: Container;
  } {
    const gameLayer = new Container();
    const uiLayer = new Container();
    const renderer = makeRenderer(gameLayer, uiLayer);
    const gameEngine = {
      player: { currentSystemId: "sys_a" },
      galaxy: {
        gameDays: 0,
        systems: [
          {
            id: "sys_a",
            planets: [makePlanet("pa"), makePlanet("pb")],
            stations: [makeStation("st_a")],
            ownerFaction: "INDEPENDENT",
          },
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
    const manager = new PlanetManager(
      renderer,
      gameEngine,
      gameLayer,
      uiLayer,
      deps,
    );
    return { manager, gameLayer };
  }

  it("rescales station labels in place without rebuilding any world sprite", () => {
    setFontScale("M");
    const { manager, gameLayer } = build();
    manager.initialize();

    // Capture the world before the font change.
    const planetsRef = manager.planetSprites;
    const planet0 = manager.planetSprites[0];
    const station0 = manager.stationMarkers[0];
    const label0 = station0.label;
    const worldBefore = [...gameLayer.children];

    expect(manager.planetSprites.length).toBe(2);
    expect(label0.style.fontSize).toBe(scaledFont(10)); // M

    setFontScale("L");
    manager.refreshFontScale();

    // The expensive sprites are the SAME instances (no rebuild).
    expect(manager.planetSprites).toBe(planetsRef);
    expect(manager.planetSprites[0]).toBe(planet0);
    expect(manager.stationMarkers[0]).toBe(station0);
    expect(station0.label).toBe(label0);
    // The game layer (planets + station containers) is byte-for-byte the same set.
    expect([...gameLayer.children]).toEqual(worldBefore);

    // …but the label font size tracked the new scale.
    expect(label0.style.fontSize).toBe(scaledFont(10)); // L now
    expect(scaledFont(10)).toBe(13); // sanity: L = round(10 × 1.25)
  });
});

describe("NpcShipManager.refreshFontScale", () => {
  function build(): { manager: NpcShipManager; gameLayer: Container } {
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = makeRenderer(gameLayer, uiLayer);
    void stage;
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
    const manager = new NpcShipManager(
      renderer,
      gameEngine,
      gameLayer,
      uiLayer,
      deps,
    );
    return { manager, gameLayer };
  }

  it("leaves the NPC ship sprites untouched (no rebuild)", () => {
    setFontScale("M");
    const { manager, gameLayer } = build();
    manager.initialize();

    expect(manager.npcCount).toBeGreaterThan(0);
    const countBefore = manager.npcCount;
    const worldBefore = [...gameLayer.children];

    setFontScale("L");
    expect(() => manager.refreshFontScale()).not.toThrow();

    expect(manager.npcCount).toBe(countBefore);
    expect([...gameLayer.children]).toEqual(worldBefore);
  });
});

describe("FlightHud.refreshFontScale", () => {
  function build(): { hud: FlightHud; uiLayer: Container } {
    const gameLayer = new Container();
    const uiLayer = new Container();
    const renderer = makeRenderer(gameLayer, uiLayer);
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
    const hud = new FlightHud(renderer, gameEngine, uiLayer);
    return { hud, uiLayer };
  }

  /** The day counter is the canonical scaled HUD label (scaledFont(14)). */
  function dayCounterFontSize(uiLayer: Container): number | undefined {
    const target = formatGameDate(0);
    return allTexts(uiLayer).find((t) => t.text === target)?.style.fontSize;
  }

  it("rebuilds the HUD text at the new scale without leaking UI objects", () => {
    setFontScale("M");
    const { hud, uiLayer } = build();
    hud.initialize();

    expect(dayCounterFontSize(uiLayer)).toBe(scaledFont(14)); // M = 14
    const childCountBefore = uiLayer.children.length;

    setFontScale("L");
    expect(() => hud.refreshFontScale()).not.toThrow();

    // Day counter rescaled; the old one was torn down (no duplicate left behind).
    expect(dayCounterFontSize(uiLayer)).toBe(scaledFont(14)); // L = 18
    expect(scaledFont(14)).toBe(18);
    expect(
      allTexts(uiLayer).filter((t) => t.text === formatGameDate(0)).length,
    ).toBe(1);
    // Teardown + rebuild is balanced: the UI layer doesn't accumulate objects.
    expect(uiLayer.children.length).toBe(childCountBefore);

    hud.destroy();
  });
});
