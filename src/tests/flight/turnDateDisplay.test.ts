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
  const shownDate = () =>
    (hud as unknown as { dayCounterText: Text }).dayCounterText.text;
  return { hud, galaxy, shownDate };
}

describe("FlightHud date read-out is clock-free (Bug 3b)", () => {
  it("a moving turn within one calendar day does not change the displayed date", () => {
    const { hud, shownDate } = buildHud();
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

    expect(t1).toBe(t0); // no clock digit moves within the same calendar day …
    expect(t2).toBe(t1);
    expect(t0).toBe(formatGameDate(5)); // … the label is exactly the calendar date
    hud.destroy();
  });

  it("a wait turn within one calendar day does not change the displayed date", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.0;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    const t0 = shownDate();
    day = 5.0 + 0.3; // 0.3 of a wait-day accrued
    hud.update(16, 0);

    expect(shownDate()).toBe(t0);
    hud.destroy();
  });

  it("crossing a whole day rolls the calendar date forward", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.9;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    expect(shownDate()).toBe(formatGameDate(5));
    day = 6.05;
    hud.update(16, 0);
    expect(shownDate()).toBe(formatGameDate(6));
    hud.destroy();
  });

  it("a combat freeze holds the date; it resumes once the fight ends", () => {
    const { hud, shownDate } = buildHud();
    let day = 5.99;
    hud.setDayProvider(() => day);

    hud.update(16, 0);
    const frozen = shownDate();
    hud.update(16, 0);
    hud.update(16, 0);
    expect(shownDate()).toBe(frozen);
    day = 6.05;
    hud.update(16, 0);
    expect(shownDate()).not.toBe(frozen);
    hud.destroy();
  });

  it("falls back to the whole-day gameDays when no provider is wired", () => {
    const { hud, galaxy, shownDate } = buildHud();
    galaxy.gameDays = 3;
    hud.update(16, 0);
    expect(shownDate()).toBe(formatGameDate(3));
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
