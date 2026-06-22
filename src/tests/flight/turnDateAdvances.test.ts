/**
 * Regression (red): "Date doesn't advance visibly during a turn"
 * (docs/plans/20260620-turn-date-not-advancing.md).
 *
 * Bug report: the player starts a turn ("Ход") and the on-screen date "stays put"
 * — there is no visible sign that time is progressing within the turn.
 *
 * Root cause under test (hypothesis 1 — whole-day granularity): the flight HUD's
 * date label renders `formatGameDate(galaxy.gameDays)`, an **integer** day, so it
 * only changes on whole-day boundaries. A turn accumulates sub-day progress
 * (`distanceTraveled` while moving, `waitDayAccum` while waiting) — the scene's
 * fractional `currentDay = gameDays + distanceTraveled/DISTANCE_PER_DAY +
 * waitDayAccum` rises continuously — but the HUD ignores it, so a turn that hasn't
 * yet crossed a full day shows a frozen date.
 *
 * This file pins the cause empirically (per memory: prove the red test red for the
 * real reason, confirm the production path), in two parts:
 *
 *   Part A (GREEN): drive a real `SpaceFlightScene` turn (moving + wait) over
 *   frames and confirm sub-day time genuinely advances — `distanceTraveled` /
 *   `waitDayAccum` grow and the fractional `currentDay` rises — while
 *   `galaxy.gameDays` stays frozen. This rules out hypotheses 3/4 (combat-frozen
 *   calendar / a genuine non-advance regression): time IS moving sub-day.
 *
 *   Part B (RED until the fix): drive a real `FlightHud` and read the date string
 *   the player actually sees (`dayCounterText.text`). As sub-day time advances
 *   within ONE whole day the displayed date must change — it currently does not.
 *   A whole-day baseline assertion stays GREEN to prove the HUD fixture is sound
 *   (the label DOES update on a whole-day tick), so the sub-day failure is the
 *   real symptom, not a broken fixture.
 *
 * Built against REAL PixiJS (Container/Text construct in jsdom without WebGL),
 * mirroring fontScaleRestyle.test.ts — only the WebGL-texture-bearing PlanetSprite
 * / PlanetInfoPanel are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Lightweight PlanetSprite / PlanetInfoPanel stand-ins (real WebGL textures aren't
// available in jsdom). Mirrors fontScaleRestyle.test.ts.
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

import { Container, Text } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { setFontScale } from "@/utils/fontScale";
import { GAME_BALANCE } from "@/config/balance";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

const DISTANCE_PER_DAY = GAME_BALANCE.pixelsPerDay; // 500 px = 1 game day

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

// ---------------------------------------------------------------------------
// Part A: a real turn genuinely advances sub-day time (pins the cause)
// ---------------------------------------------------------------------------

describe("a turn advances sub-day time (the date SOURCE moves)", () => {
  /** Build a bare SpaceFlightScene with just the fields updateShip touches set. */
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
    };
    s.npcManager = { followNpcId: null, refresh: vi.fn() };
    s.combatModule = { isActive: false };
    s.pendingWarp = null;
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy,
      advanceGalaxyDay: vi.fn(() => {
        galaxy.gameDays++;
      }),
    };
    const updateShip = (dt: number) =>
      (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
    /** The fractional day the player's date OUGHT to reflect (orbit source). */
    const currentDay = () =>
      galaxy.gameDays +
      (s.distanceTraveled as number) / DISTANCE_PER_DAY +
      (s.waitDayAccum as number);
    return { s, galaxy, updateShip, currentDay };
  }

  it("a short moving turn advances the fractional day but NOT the whole-day counter", () => {
    // A ship that crawls 120 px/frame: < DISTANCE_PER_DAY (500), so no whole day
    // is crossed across these frames — yet distance (sub-day time) accrues.
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 120;
      }),
    };
    const { s, galaxy, updateShip, currentDay } = buildScene(physics);
    s.isTurnRunning = true;

    const dayBefore = currentDay();
    updateShip(16);
    updateShip(16);
    updateShip(16); // 3 × 120 = 360 px < 500 → still day 0

    expect(galaxy.gameDays).toBe(0); // whole-day counter frozen mid-turn …
    expect(s.distanceTraveled as number).toBeGreaterThan(0); // … but distance accrued
    expect(currentDay()).toBeGreaterThan(dayBefore); // fractional day advanced
  });

  it("a short wait turn advances the fractional day but NOT the whole-day counter", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: false,
      currentSpeed: 0,
      timeScale: 1,
      update: vi.fn(),
    };
    const { s, galaxy, updateShip, currentDay } = buildScene(physics);
    s.isTurnRunning = true;

    const dayBefore = currentDay();
    updateShip(300);
    updateShip(300); // 2 × 300 ms = 0.6 wait-day < 1000 ms/day → still day 0

    expect(galaxy.gameDays).toBe(0); // whole-day counter frozen mid-wait …
    expect(s.waitDayAccum as number).toBeGreaterThan(0); // … but wait-time accrued
    expect(currentDay()).toBeGreaterThan(dayBefore); // fractional day advanced
  });
});

// ---------------------------------------------------------------------------
// Part B: the date the PLAYER sees must advance during a turn (RED until fix)
// ---------------------------------------------------------------------------

describe("the HUD date the player sees advances during a turn", () => {
  function buildHud() {
    const uiLayer = new Container();
    const galaxy: { gameDays: number } = { gameDays: 0 };
    const gameEngine = {
      galaxy,
      audio: {
        playUiClick: () => {},
        playUiHover: () => {},
        playToast: () => {},
      },
      questManager: {},
      player: { getReputation: () => 0 },
    } as unknown as GameEngine;
    const hud = new FlightHud(makeRenderer(), gameEngine, uiLayer);
    hud.initialize();
    /** The date string the player actually sees in the top-left HUD label. */
    const shownDate = () =>
      (hud as unknown as { dayCounterText: Text }).dayCounterText.text;
    const render = (day: number) => {
      galaxy.gameDays = day; // the day-of-turn the HUD has to surface
      hud.update(16, 0);
      return shownDate();
    };
    return { hud, render };
  }

  // Baseline (GREEN, before AND after the fix): a whole-day boundary changes the
  // displayed date. Proves the HUD label fixture is sound — so the sub-day red
  // below is the genuine symptom, not a broken harness.
  it("baseline: a whole-day tick visibly changes the date", () => {
    const { hud, render } = buildHud();
    const d0 = render(0);
    const d1 = render(1);
    expect(d1).not.toBe(d0);
    hud.destroy();
  });

  // RED until the fix — committed as `it.fails` (the codebase convention for a
  // Task-1 red repro, mirroring waitTurnPause.test.ts) so the pre-commit suite
  // stays green while the bug is documented; Task 2 flips it to `it` once the fix
  // lands. While a turn is mid-day the day-of-turn carries a growing fraction
  // (gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum); the displayed
  // date must reflect that sub-day progress so the player sees time moving. Today
  // the HUD floors to the integer day, so all three reads are the same string —
  // the date looks frozen.
  it.fails(
    "sub-day progress within one whole day is visible to the player",
    () => {
      const { hud, render } = buildHud();
      const atDayStart = render(5.0);
      const atQuarterDay = render(5.25);
      const atThreeQuarterDay = render(5.75);

      expect(atQuarterDay).not.toBe(atDayStart);
      expect(atThreeQuarterDay).not.toBe(atQuarterDay);
      hud.destroy();
    },
  );
});
