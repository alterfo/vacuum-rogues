/**
 * Task 1 — reproduce: planets stop orbiting during a real-time fight (RED).
 *
 * Orbital position is a pure function of `SpaceFlightScene.currentDay`
 * (`gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum`), surfaced to the
 * planets through `getOrbitalDay: () => this.currentDay`. During an in-flight fight
 * the ship is stationary, so `distanceTraveled` never grows, and `advanceWaitTime`
 * — the only sub-day source for a *still* ship — is gated off while a fight is
 * active (the wait guard at the bottom of `updateShip` excludes
 * `combatModule.isActive`). Fire is already decoupled from the calendar
 * (`CombatModule` runs in real time off `isPaused`), but orbit time is **not** — so
 * a real-time fight advances bullets while the planets freeze on their orbital path,
 * which looks broken.
 *
 * The body asserts the CORRECT behaviour — `currentDay` (the orbit source) advances
 * across update frames while a fight is engaged and **not** paused. It currently
 * does NOT advance, so the assertion throws and `it.fails` passes — proof the orbits
 * freeze in combat. Task 2 adds a combat-time day source and flips this to a plain
 * `it` (green regression).
 *
 * Built the way `turnDateAdvances.test.ts` drives a real `SpaceFlightScene`: a bare
 * scene with just the fields `updateShip` touches set, only the WebGL-texture-bearing
 * `PlanetSprite` / `PlanetInfoPanel` stubbed.
 */
import { describe, it, expect, vi } from "vitest";

// Lightweight PlanetSprite / PlanetInfoPanel stand-ins (real WebGL textures aren't
// available in jsdom). Mirrors turnDateAdvances.test.ts.
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

/**
 * A bare `SpaceFlightScene` wired with just the fields `updateShip` touches, set up
 * for an in-flight fight: a **stationary** ship (so neither move-distance nor the
 * wait-turn path adds time on its own), `combatModule.isActive === true`, and a
 * **controllable** active-pause flag so a test can drive the real-time portion of
 * the fight (`paused === false`) and the active pause (`paused === true`).
 */
function buildCombatScene() {
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
  s.combatModule = { isActive: true }; // a fight is engaged
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
  /** The scene's REAL fractional-day getter — the production source that
   * `getOrbitalDay: () => this.currentDay` hands to the planets. Reading it here
   * (not a local re-derivation) keeps the assertion honest. */
  const currentDay = () => s.currentDay as number;
  return { s, galaxy, combatPause, updateShip, currentDay };
}

describe("planets keep orbiting during a real-time fight (Task 1 — repro)", () => {
  it.fails(
    "the orbital day advances while a fight is engaged and NOT paused",
    () => {
      const { updateShip, currentDay, combatPause } = buildCombatScene();
      combatPause.paused = false; // real-time portion of the fight

      const before = currentDay();
      // Several real-time frames pass with the ship stationary in combat. A
      // stationary fight still passes time, so the planets must keep orbiting —
      // i.e. the orbital-day source must rise.
      updateShip(300);
      updateShip(300);
      updateShip(300);

      expect(currentDay()).toBeGreaterThan(before);
    },
  );
});
