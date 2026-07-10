/**
 * Regression (red): "planets don't orbit while the ship is moving — only when
 * stationary + «Ход» pressed".
 *
 * Root cause: planet orbital position is `f(SpaceFlightScene.currentDay)`.
 * `currentDay` advances two different ways: a stationary wait turn adds real
 * time at a FIXED rate (`MS_PER_WAIT_DAY` = 1000ms/day, "день = секунда",
 * US-070); a moving turn adds `distanceTraveled / DISTANCE_PER_DAY`, which
 * depends on the ship's actual cruise speed (0.08 px/ms for a starter engine up
 * to 0.29 px/ms for a top-tier one) — 5-10x slower than the wait rate. Planets
 * DO keep orbiting while flying, just too slowly to read as motion, while a
 * wait turn visibly spins them — so the two feel inconsistent.
 *
 * The fix (`visualOrbitBoost`) is presentation-only: it never advances
 * `gameDays`, never touches the HUD date, and never accelerates economy/quest/
 * NPC-sim pacing — only the value fed to `getOrbitalDay()` (planet orbit
 * visuals) gets a real-time top-up while the ship is moving, at the SAME rate
 * as the existing wait/combat-stationary sources, so orbit motion reads
 * consistently regardless of ship speed or movement state.
 *
 * Built the way `turnDateAdvances.test.ts` / `orbitsDuringCombat.test.ts` drive
 * a real `SpaceFlightScene`: a bare scene with just the fields `updateShip`
 * touches set.
 */
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

/** A bare `SpaceFlightScene` wired with just the fields `updateShip` touches. */
function buildScene(physics: Record<string, unknown>) {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const galaxy = { gameDays: 0 };
  s.shipPhysics = physics;
  s.hud = { showMessage: vi.fn() };
  s.playerShip = { isArcActive: () => false };
  s.starRenderer = { updateSunContactDamage: () => false };
  s.planetManager = {
    routeTargetStationId: null,
    routeTargetPlanetId: null,
    stationMarkers: [],
    planetSprites: [],
    landingThreshold: () => 0,
    setCursors: vi.fn(),
  };
  s.npcManager = { followNpcId: null, refresh: vi.fn(), setCursors: vi.fn() };
  s.combatModule = { isActive: false };
  s.combatPause = { paused: false };
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
  /** The scene's REAL `orbitalVisualDay` getter — the production source
   * `getOrbitalDay: () => this.orbitalVisualDay` hands to `PlanetManager`.
   * Reading the getter (not a local `currentDay + visualOrbitBoost`
   * re-derivation) keeps the assertion honest: reverting the production sum
   * to plain `currentDay` reds these tests. */
  const orbitalVisualDay = () => s.orbitalVisualDay as number;
  const currentDay = () => s.currentDay as number;
  const endTurn = () => (scene as unknown as { endTurn(): void }).endTurn();
  return { s, galaxy, updateShip, orbitalVisualDay, currentDay, endTurn };
}

describe("planet orbit visuals keep pace while the ship is genuinely moving", () => {
  it("a slow-engine flight tops up the orbital-visual day near the wait-turn rate, without inflating gameDays", () => {
    // A slow starter-engine ship: 2 px/frame at 16ms/frame — far below
    // DISTANCE_PER_DAY (500px over 60 frames = 120px total), so the raw
    // distance-based day source alone would barely move the orbit over this
    // span (and never crosses a whole-day boundary).
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
    };
    const { galaxy, updateShip, orbitalVisualDay, currentDay } =
      buildScene(physics);

    const dayBefore = currentDay();
    const visualBefore = orbitalVisualDay();
    for (let i = 0; i < 60; i++) updateShip(16); // 60 x 16ms = 960ms of flight

    // Economy is untouched: no whole day crossed (120px < 500px), and gameDays
    // only ever advances through the real distance path.
    expect(galaxy.gameDays).toBe(0);
    // The bare distance-based day source barely moved (matches the old, buggy read).
    expect(currentDay() - dayBefore).toBeLessThan(0.3);
    // But the orbital-VISUAL day the planets actually read topped up close to
    // the wait-turn's 1-day-per-960ms pace — the fix.
    expect(orbitalVisualDay() - visualBefore).toBeGreaterThan(0.8);
  });

  it("leaves the stationary wait-turn path byte-for-byte unchanged (no double counting)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: false,
      currentSpeed: 0,
      timeScale: 1,
      update: vi.fn(),
    };
    const { updateShip, orbitalVisualDay, currentDay } = buildScene(physics);

    const dayBefore = currentDay();
    for (let i = 0; i < 60; i++) updateShip(16);

    // Stationary path is untouched: the visual day still equals the plain
    // currentDay (no extra boost applied while not moving).
    expect(orbitalVisualDay()).toBe(currentDay());
    expect(currentDay()).toBeGreaterThan(dayBefore);
  });

  it("settles the boost to 0 on endTurn, same as the existing waitDayAccum/distanceTraveled settle", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
      setTarget: vi.fn(),
    };
    const { updateShip, orbitalVisualDay, currentDay, endTurn } =
      buildScene(physics);

    for (let i = 0; i < 60; i++) updateShip(16);
    expect(orbitalVisualDay()).toBeGreaterThan(currentDay());

    endTurn();
    expect(orbitalVisualDay()).toBe(currentDay());
  });

  it("freezes the top-up while the combat active-pause is up (pause freezes orbits with movement)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(),
    };
    const { s, updateShip, orbitalVisualDay, currentDay } = buildScene(physics);
    s.combatPause = { paused: true };

    for (let i = 0; i < 60; i++) updateShip(16);

    // orbitBump returns 0 while paused — no boost accrues.
    expect(orbitalVisualDay()).toBe(currentDay());
  });

  it("scales the top-up by ShipPhysics.timeScale (fast-forward spins orbits faster)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 2,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
    };
    const { updateShip, orbitalVisualDay } = buildScene(physics);

    const visualBefore = orbitalVisualDay();
    for (let i = 0; i < 60; i++) updateShip(16); // 960ms at 2× ≈ 1.92 wait-days

    expect(orbitalVisualDay() - visualBefore).toBeGreaterThan(1.6);
  });
});

describe("production wiring guard", () => {
  it("SpaceFlightScene hands PlanetManager the boosted orbitalVisualDay, not plain currentDay", async () => {
    // The behaviour tests above stub planetManager, so they can't catch a
    // silent revert of the deps line itself (`getOrbitalDay: () =>
    // this.currentDay` was the exact pre-fix code). Lock the seam at source
    // level, same idiom as the scene's line-count guard.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/presentation/SpaceFlightScene.ts", "utf-8");
    expect(src).toMatch(/getOrbitalDay:\s*\(\)\s*=>\s*this\.orbitalVisualDay/);
  });
});
