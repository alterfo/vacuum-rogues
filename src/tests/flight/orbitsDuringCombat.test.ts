/**
 * Regression — planets keep orbiting during a real-time fight
 * (docs/plans/20260625-orbits-advance-during-combat.md).
 *
 * Orbital position is a pure function of `SpaceFlightScene.currentDay`
 * (`gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum`), surfaced to the
 * planets through `getOrbitalDay: () => this.currentDay`. During an
 * in-flight fight the ship is stationary, so `distanceTraveled` never grows, and
 * `advanceWaitTime` — the only sub-day source for a *still* ship — is gated off while
 * a fight is active (the wait guard at the bottom of `updateShip` excludes
 * `combatModule.isActive`). Fire is already decoupled from the calendar
 * (`CombatModule` runs in real time off `isPaused`), but before this fix orbit time
 * was **not** — so a real-time fight advanced bullets while the planets froze on
 * their orbital path.
 *
 * Task 2 feeds a presentation-only combat-day increment (the pure
 * `combatOrbitalDayIncrement`) into the existing `waitDayAccum` accumulator, advancing
 * the orbital day at the wait-turn rate during the real-time portion of a fight and
 * holding while the active pause is up.
 * This file pins that behaviour against a real `SpaceFlightScene`:
 *   • the orbital day advances while a fight is engaged and NOT paused (was the Task-1
 *     red repro, committed as `it.fails`; now a plain green `it`),
 *   • it holds while the active pause is up (pause = everything frozen),
 *   • the normal stationary wait-turn path is unchanged.
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
 * wait-turn path adds time on its own), a configurable `combatModule.isActive`, and a
 * **controllable** active-pause flag so a test can drive the real-time portion of
 * the fight (`paused === false`) and the active pause (`paused === true`).
 */
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
  /** The scene's REAL fractional-day getter — the production source that
   * `getOrbitalDay: () => this.currentDay` hands to the planets. Reading it here
   * (not a local re-derivation) keeps the assertion honest. */
  const currentDay = () => s.currentDay as number;
  return { s, galaxy, combatPause, updateShip, currentDay };
}

describe("planets keep orbiting during a real-time fight", () => {
  it("the orbital day advances while a fight is engaged and NOT paused", () => {
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

    // Enough real-time combat to cross a whole wait-day boundary (3 × 400 ms > 1000).
    updateShip(400);
    updateShip(400);
    updateShip(400);

    expect(galaxy.gameDays).toBe(0); // the real calendar/NPC sim stays frozen in combat
  });

  it("leaves the normal stationary wait-turn path unchanged (no fight engaged)", () => {
    // combatModule inactive: the existing wait-time source must still advance the day.
    const { updateShip, currentDay } = buildCombatScene({ inCombat: false });

    const before = currentDay();
    updateShip(300);
    updateShip(300);

    expect(currentDay()).toBeGreaterThan(before); // wait-turn day source intact
  });

  it("a MOVING combat orbit freezes the real calendar yet still advances orbital time", () => {
    // Regression (review fix): steerCombatOrbit keeps the ship cruising while
    // engaged, so the distance day-advance path runs DURING combat. It must NOT
    // tick the real calendar (advanceGalaxyDay → refresh() can despawn the live
    // target), but planets must keep orbiting. The stationary-only sibling test
    // above passes even with the bug present — only a moving orbit exposes it.
    const { s, galaxy, currentDay, updateShip } = buildCombatScene();
    const phys = s.shipPhysics as unknown as {
      shipX: number;
      isMoving: boolean;
      currentSpeed: number;
      update: (dt: number) => void;
    };
    phys.isMoving = true; // the orbit holds the ship in continuous cruise
    phys.currentSpeed = 5;
    // Each frame the ship advances 300px; 3 frames = 900px > pixelsPerDay (500),
    // so the distance loop crosses a day boundary mid-fight.
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
