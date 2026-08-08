import { describe, it, expect } from "vitest";
import { PlanetSprite } from "@/presentation/PlanetSprite";
import { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";

const stubMarket = {
  goods: [],
  getPrice: () => 0,
  updatePrices: () => {},
} as unknown as import("@/domain/Market").Market;

function makePlanet(orbitalRadius: number): Planet {
  return new Planet(
    "p-orbit-slow",
    "Орбитест",
    PlanetType.TERRESTRIAL,
    orbitalRadius,
    stubMarket,
    [],
    [],
    true,
    0,
    0,
    null,
  );
}

const PRE_CHANGE_BASE_PERIOD_DAYS = 80;
const SLOWDOWN_FACTOR = 5;

function preChangeSpeed(orbitalRadius: number): number {
  const periodDays =
    PRE_CHANGE_BASE_PERIOD_DAYS * Math.pow(orbitalRadius / 600, 1.5);
  const radPerDay = (Math.PI * 2) / periodDays;
  return orbitalRadius * radPerDay;
}

describe("PlanetSprite orbit speed 5x slowdown", () => {
  it("orbital tangential speed is 1/5 of the pre-change value for a fixed radius", () => {
    const radius = 800;
    const sprite = new PlanetSprite(makePlanet(radius), 0, 0, 0);
    const v = sprite.orbitalVelocityPerDay();
    const speed = Math.hypot(v.vx, v.vy);

    expect(speed).toBeCloseTo(preChangeSpeed(radius) / SLOWDOWN_FACTOR, 6);

    sprite.destroy();
  });

  it("outer-slower-than-inner relation still holds after the slowdown", () => {
    const inner = new PlanetSprite(makePlanet(600), 0, 0, 0);
    const outer = new PlanetSprite(makePlanet(2400), 0, 0, 0);

    const speed = (s: PlanetSprite): number => {
      const v = s.orbitalVelocityPerDay();
      return Math.hypot(v.vx, v.vy);
    };
    expect(speed(outer)).toBeLessThan(speed(inner));

    inner.destroy();
    outer.destroy();
  });
});
