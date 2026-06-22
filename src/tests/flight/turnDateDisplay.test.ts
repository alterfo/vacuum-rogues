/**
 * Task 2 (docs/plans/20260620-turn-date-not-advancing.md): the HUD date read-out
 * now surfaces sub-day turn progress so time visibly moves within a turn.
 *
 * The scene pushes its fractional `currentDay` (= gameDays + distanceTraveled/
 * DISTANCE_PER_DAY + waitDayAccum) into the HUD via `setDayProvider`; the day
 * counter renders `formatGameTimestamp(day)` — the calendar date plus a HH:MM
 * clock derived from the fractional part. These tests drive a real `FlightHud`
 * (real PixiJS Container/Text in jsdom, no WebGL — mirrors fontScaleRestyle.test.ts)
 * and assert the displayed string advances for the adjacent cases the plan calls
 * out: a moving turn, a wait turn, a whole-day roll, and a post-combat resume.
 */
import { describe, it, expect } from "vitest";
import { Container, Text } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { formatGameDate, formatGameTimestamp } from "@/utils/gameCalendar";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

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
  return { hud, galaxy, shownDate };
}

describe("FlightHud date read-out shows sub-day turn progress", () => {
  it("a moving turn advances the displayed time within one calendar day", () => {
    const { hud, shownDate } = buildHud();
    // The scene's currentDay rises continuously as distanceTraveled accrues; the
    // ship hasn't crossed a whole day, so gameDays stays at 5.
    let day = 5.0;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    const t0 = shownDate();
    day = 5.4;
    hud.update(16, 0);
    const t1 = shownDate();
    day = 5.8;
    hud.update(16, 0);
    const t2 = shownDate();

    expect(t1).not.toBe(t0); // time visibly moved …
    expect(t2).not.toBe(t1);
    expect(t0).toContain(formatGameDate(5)); // … but the calendar date held (still day 5)
    expect(t2).toContain(formatGameDate(5));
    hud.destroy();
  });

  it("a wait turn advances the displayed time as waitDayAccum grows", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.0;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    const t0 = shownDate();
    day = 5.0 + 0.3; // 0.3 of a wait-day accrued
    hud.update(16, 0);

    expect(shownDate()).not.toBe(t0);
    hud.destroy();
  });

  it("crossing a whole day rolls the calendar date forward", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.9;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    expect(shownDate()).toContain(formatGameDate(5));
    // advanceGalaxyDay bumped gameDays and reset the sub-day fraction.
    day = 6.05;
    hud.update(16, 0);
    expect(shownDate()).toContain(formatGameDate(6));
    hud.destroy();
  });

  it("a combat freeze holds the date; it resumes once the fight ends", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.2;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    const frozen = shownDate();
    // While combat is paused the scene's currentDay does not advance (updateShip
    // early-returns), so repeated frames render the same timestamp — the freeze
    // is intended and visible, not a stuck clock.
    hud.update(16, 0);
    hud.update(16, 0);
    expect(shownDate()).toBe(frozen);
    // Fight ends → the turn resumes → currentDay advances again → the date moves.
    day = 5.5;
    hud.update(16, 0);
    expect(shownDate()).not.toBe(frozen);
    hud.destroy();
  });

  it("falls back to the whole-day gameDays when no provider is wired", () => {
    const { hud, galaxy, shownDate } = buildHud();
    galaxy.gameDays = 3;
    hud.update(16, 0);
    expect(shownDate()).toContain(formatGameDate(3));
    hud.destroy();
  });
});

describe("formatGameTimestamp", () => {
  it("renders the calendar date plus a sub-day HH:MM clock", () => {
    expect(formatGameTimestamp(5.0)).toBe(`${formatGameDate(5)} 00:00`);
    expect(formatGameTimestamp(5.25)).toBe(`${formatGameDate(5)} 06:00`);
    expect(formatGameTimestamp(5.75)).toBe(`${formatGameDate(5)} 18:00`);
  });

  it("rolls the date on the whole-day boundary and clamps negatives", () => {
    expect(formatGameTimestamp(6.0)).toBe(`${formatGameDate(6)} 00:00`);
    expect(formatGameTimestamp(-1)).toBe(`${formatGameDate(0)} 00:00`);
  });
});
