import { describe, it, expect, vi } from "vitest";

vi.mock("@/presentation/PlanetSprite", async () => {
  const { Container: PixiContainer, Graphics } = await import("pixi.js");
  return {
    PlanetSprite: class {
      container = new PixiContainer();
      graphics = new Graphics();
      createHitArea(): void {}
      setTooltipHandlers(): void {}
      setOrbitForDay(): void {}
      update(): void {}
      destroy(): void {}
    },
  };
});
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: class {
    container = { addChild: (): void => {} };
    destroy(): void {}
  },
}));

import { Container } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function buildCombatScene(opts: { inCombat?: boolean } = {}) {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const galaxy = { gameDays: 0 };
  const combatPause = { paused: false };
  s.shipPhysics = {
    shipX: 0,
    shipY: 0,
    isMoving: false, // stationary fight — the ship holds position
    currentSpeed: 0,
    timeScale: 1,
    update: vi.fn(),
  };
  s.hud = { showMessage: vi.fn() };
  s.playerShip = { isArcActive: () => false };
  s.starRenderer = { updateSunContactDamage: () => false };
  s.planetManager = {
    routeTargetStationId: null,
    routeTargetPlanetId: null,
    stationMarkers: [],
    planetSprites: [],
    landingThreshold: () => 0,
  };
  s.npcManager = { followNpcId: null, refresh: vi.fn() };
  s.combatModule = { isActive: opts.inCombat ?? true }; // a fight is engaged by default
  s.combatPause = combatPause;
  s.pendingWarp = null;
  s.gameEngine = {
    player: { ship: { hullHP: 100, maxHull: 100 } },
    galaxy,
    advanceGalaxyDay: vi.fn(() => {
      galaxy.gameDays++;
    }),
  };
  s.isTurnRunning = true;

  const updateShip = (dt: number) =>
    (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
  const currentDay = () => s.currentDay as number;
  return { s, galaxy, combatPause, updateShip, currentDay };
}

describe("planets keep orbiting during a real-time fight", () => {
  it("the orbital day advances while a fight is engaged and NOT paused", () => {
    const { updateShip, currentDay, combatPause } = buildCombatScene();
    combatPause.paused = false; // real-time portion of the fight

    const before = currentDay();
    updateShip(300);
    updateShip(300);
    updateShip(300);

    expect(currentDay()).toBeGreaterThan(before);
  });

  it("the orbital day holds while the active pause is up (pause = everything frozen)", () => {
    const { updateShip, currentDay, combatPause } = buildCombatScene();
    combatPause.paused = true; // active pause raised

    const before = currentDay();
    updateShip(300);
    updateShip(300);
    updateShip(300);

    expect(currentDay()).toBe(before); // frozen — no orbital progress while paused
  });

  it("does not advance the calendar (gameDays) during combat — presentation-only", () => {
    const { updateShip, galaxy, combatPause } = buildCombatScene();
    combatPause.paused = false;

    updateShip(400);
    updateShip(400);
    updateShip(400);

    expect(galaxy.gameDays).toBe(0); // the real calendar/NPC sim stays frozen in combat
  });

  it("leaves the normal stationary wait-turn path unchanged (no fight engaged)", () => {
    const { updateShip, currentDay } = buildCombatScene({ inCombat: false });

    const before = currentDay();
    updateShip(300);
    updateShip(300);

    expect(currentDay()).toBeGreaterThan(before); // wait-turn day source intact
  });

  it("a MOVING combat orbit freezes the real calendar yet still advances orbital time", () => {
    const { s, galaxy, currentDay, updateShip } = buildCombatScene();
    const phys = s.shipPhysics as unknown as {
      shipX: number;
      isMoving: boolean;
      currentSpeed: number;
      update: (dt: number) => void;
    };
    phys.isMoving = true; // the orbit holds the ship in continuous cruise
    phys.currentSpeed = 5;
    phys.update = (): void => {
      phys.shipX += 300;
    };
    const advanceSpy = (
      s.gameEngine as unknown as { advanceGalaxyDay: ReturnType<typeof vi.fn> }
    ).advanceGalaxyDay;

    const before = currentDay();
    updateShip(16);
    updateShip(16);
    updateShip(16);

    expect(galaxy.gameDays).toBe(0); // real calendar frozen across the moving orbit
    expect(advanceSpy).not.toHaveBeenCalled(); // and the NPC-sim day-tick never ran
    expect(currentDay()).toBeGreaterThan(before); // orbital time still advances
  });
});
