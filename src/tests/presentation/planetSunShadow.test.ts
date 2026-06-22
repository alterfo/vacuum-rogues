import { describe, it, expect } from "vitest";
import { PlanetRotationFilter } from "@/presentation/filters/PlanetRotationFilter";
import { PlanetSprite } from "@/presentation/PlanetSprite";
import { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";

// Minimal Market stub so Planet can be constructed without real infrastructure.
const stubMarket = {
  goods: [],
  getPrice: () => 0,
  updatePrices: () => {},
} as unknown as import("@/domain/Market").Market;

function makePlanet(orbitalRadius = 800): Planet {
  return new Planet(
    "p-sun",
    "Тень",
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

/** Read the raw uLightDir uniform array off the filter's uniform group. */
function uLightDir(f: PlanetRotationFilter): Float32Array {
  return (
    f as unknown as {
      resources: {
        planetUniforms: { uniforms: { uLightDir: Float32Array } };
      };
    }
  ).resources.planetUniforms.uniforms.uLightDir;
}

describe("PlanetRotationFilter sun-direction terminator", () => {
  it("defaults the light direction to (1, 0)", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    expect(f.lightDir[0]).toBeCloseTo(1);
    expect(f.lightDir[1]).toBeCloseTo(0);
  });

  it("normalizes the planet→star vector into the uLightDir uniform", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    f.setLightDirection(0, -10); // straight up, unnormalized
    expect(f.lightDir[0]).toBeCloseTo(0);
    expect(f.lightDir[1]).toBeCloseTo(-1);
    const u = uLightDir(f);
    expect(u[0]).toBeCloseTo(0);
    expect(u[1]).toBeCloseTo(-1);
  });

  it("normalizes a diagonal direction to unit length", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    f.setLightDirection(3, 4);
    expect(Math.hypot(f.lightDir[0], f.lightDir[1])).toBeCloseTo(1);
    expect(f.lightDir[0]).toBeCloseTo(0.6);
    expect(f.lightDir[1]).toBeCloseTo(0.8);
  });

  it("ignores a zero-length vector and keeps the last direction", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    f.setLightDirection(1, 0);
    f.setLightDirection(0, 0); // planet exactly on the star — no change
    expect(f.lightDir[0]).toBeCloseTo(1);
    expect(f.lightDir[1]).toBeCloseTo(0);
  });

  it("keeps the terminator independent of axial rotation", () => {
    // advance() spins the surface (uOffset) but must NOT touch uLightDir, so the
    // sun stays fixed while the planet rotates under it.
    const f = new PlanetRotationFilter({ rotationSpeed: 0.002 });
    f.setLightDirection(0, 1);
    f.advance(500);
    expect(f.lightDir[0]).toBeCloseTo(0);
    expect(f.lightDir[1]).toBeCloseTo(1);
  });

  describe("fragment shader terminator (source-level guard)", () => {
    const fragment = () =>
      new PlanetRotationFilter({ rotationSpeed: 0.001 }).glProgram.fragment;

    it("declares the uLightDir uniform", () => {
      expect(fragment()).toMatch(/uniform\s+vec2\s+uLightDir\s*;/);
    });

    it("derives the day/night term from dot(p, uLightDir)", () => {
      // The sphere normal's (x, y) equals the disc point p, and the star sits in
      // the screen plane, so the diffuse term is dot(p, uLightDir).
      expect(fragment()).toMatch(/dot\s*\(\s*p\s*,\s*uLightDir\s*\)/);
    });
  });
});

describe("PlanetSprite star-light direction (feeds the terminator)", () => {
  it("points from the planet back toward the system star", () => {
    // Star at (1000, 500); a planet at baseAngle 0 sits at +x of its orbit, so
    // the star lies straight to its left → light direction (-1, 0).
    const sprite = new PlanetSprite(makePlanet(800), 1000, 500, 0);
    sprite.setOrbitForDay(0);
    const dir = sprite.lightDirection();
    expect(dir.x).toBeCloseTo(-1);
    expect(dir.y).toBeCloseTo(0);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
    sprite.destroy();
  });

  it("tracks the star as the planet orbits (unit length, star-pointing)", () => {
    const cx = 1000;
    const cy = 500;
    const sprite = new PlanetSprite(makePlanet(800), cx, cy, Math.PI / 2);
    sprite.setOrbitForDay(0);
    const dir = sprite.lightDirection();
    // The unit direction must point back toward the star centre from the planet.
    const towardStarX = cx - sprite.screenX;
    const towardStarY = cy - sprite.screenY;
    const dot = dir.x * towardStarX + dir.y * towardStarY;
    expect(dot).toBeGreaterThan(0);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
    sprite.destroy();
  });
});
