/**
 * Regression (docs/plans/20260620-planets-moons-rotate-during-pause.md):
 * pause applies **only to ships** — the ambient solar system stays alive. So a
 * planet's cosmetic axial spin + moon rotation (driven by `sprite.update(dt)`)
 * must advance on real elapsed time even while the turn is paused, matching the
 * sun and comets. Only the orbital POSITION stays day-tied (frozen when paused,
 * by design — chase/intercept lead + route targeting rely on it).
 *
 * Exercised through PlanetManager.update with a mocked PlanetSprite so no
 * WebGL/texture context is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    zIndex: 0,
    x: 0,
    y: 0,
    on: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: {},
    })),
  };
});

vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn().mockImplementation((planet) => ({
    planet,
    screenX: 100,
    screenY: 200,
    displayRadius: 60,
    container: { addChild: vi.fn(), children: [], zIndex: 0 },
    graphics: { cursor: "pointer" },
    createHitArea: vi.fn(),
    setTooltipHandlers: vi.fn(),
    setOrbitForDay: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { Planet } from "@/domain/Planet";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
  });
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
  } as unknown as Renderer;
}

function makePlanet(id: string): Planet {
  return { id, name: id.toUpperCase() } as unknown as Planet;
}

/** Mutable knobs so each test can flip pause / timeScale / game-day. */
interface Knobs {
  turnRunning: boolean;
  timeScale: number;
  orbitalDay: number;
}

function makeHarness(knobs: Knobs): {
  manager: PlanetManager;
  deps: PlanetManagerDeps;
} {
  const renderer = makeMockRenderer();
  const gameEngine = {
    player: { currentSystemId: "sys_a" },
    galaxy: {
      gameDays: 0,
      systems: [
        {
          id: "sys_a",
          planets: [makePlanet("pa"), makePlanet("pb")],
          stations: [],
          ownerFaction: "INDEPENDENT",
        },
      ],
    },
    questManager: { getActiveQuestLocations: () => [] },
  } as unknown as GameEngine;

  const deps: PlanetManagerDeps = {
    getShipPhysics: () =>
      ({
        shipX: 0,
        shipY: 0,
        timeScale: knobs.timeScale,
      }) as unknown as ShipPhysics,
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => knobs.turnRunning,
    getOrbitalDay: () => knobs.orbitalDay,
    showPlanetTooltip: () => {},
    hideTooltip: () => {},
    clearFollow: () => {},
  };

  const manager = new PlanetManager(
    renderer,
    gameEngine,
    renderer.gameLayer,
    renderer.uiLayer,
    deps,
  );
  return { manager, deps };
}

describe("PlanetManager.update — spin keeps running while paused", () => {
  const DT = 1 / 60;
  let knobs: Knobs;
  let manager: PlanetManager;

  beforeEach(() => {
    knobs = { turnRunning: false, timeScale: 1, orbitalDay: 0 };
    ({ manager } = makeHarness(knobs));
    manager.initialize();
  });

  it("advances axial spin + moons every frame while paused (real-time, base 1×)", () => {
    knobs.turnRunning = false; // ship/NPC/combat frozen…
    knobs.timeScale = 4; // …and a stale fast-forward scale must NOT apply when paused
    manager.update(DT, 100);

    for (const sprite of manager.planetSprites) {
      // Spin/moons still tick — and at base rate, not ×timeScale (paused).
      expect(sprite.update).toHaveBeenCalledTimes(1);
      expect(sprite.update).toHaveBeenCalledWith(DT);
    }
  });

  it("scales the spin by timeScale while the turn is running (fast-forward)", () => {
    knobs.turnRunning = true;
    knobs.timeScale = 3;
    manager.update(DT, 100);

    for (const sprite of manager.planetSprites) {
      expect(sprite.update).toHaveBeenCalledTimes(1);
      expect(sprite.update).toHaveBeenCalledWith(DT * 3);
    }
  });

  it("orbital position stays a function of game-days regardless of pause/resume", () => {
    // Paused at day 5 → orbit positioned for day 5.
    knobs.turnRunning = false;
    knobs.orbitalDay = 5;
    manager.update(DT, 100);
    for (const sprite of manager.planetSprites) {
      expect(sprite.setOrbitForDay).toHaveBeenLastCalledWith(5);
    }

    // Resume the turn but keep the same game-day → orbit position unchanged
    // (it tracks days, not the pause flag).
    knobs.turnRunning = true;
    manager.update(DT, 100);
    for (const sprite of manager.planetSprites) {
      expect(sprite.setOrbitForDay).toHaveBeenLastCalledWith(5);
    }
  });
});
