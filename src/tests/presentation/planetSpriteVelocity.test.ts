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
    "p-vel",
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

describe("PlanetSprite.orbitalVelocityPerDay (playtest4 C lead)", () => {
  it("returns the orbit tangent (perpendicular to the radius) at angle 0", () => {
    const sprite = new PlanetSprite(makePlanet(800), 0, 0, 0);
    const v = sprite.orbitalVelocityPerDay();

    expect(v.vx).toBeCloseTo(0, 6);
    expect(v.vy).toBeGreaterThan(0);
    const dot = v.vx * sprite.screenX + v.vy * sprite.screenY;
    expect(dot).toBeCloseTo(0, 3);

    sprite.destroy();
  });

  it("rotates the tangent with the planet's orbital position", () => {
    const sprite = new PlanetSprite(makePlanet(800), 0, 0, Math.PI / 2);
    const v = sprite.orbitalVelocityPerDay();

    expect(v.vx).toBeLessThan(0);
    expect(v.vy).toBeCloseTo(0, 6);

    sprite.destroy();
  });

  it("outer planets orbit slower (smaller tangential speed) than inner ones", () => {
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
