import { describe, it, expect } from "vitest";
import {
  PlanetRotationFilter,
  createPlanetRotationFilter,
  wrapUnit,
} from "@/presentation/filters/PlanetRotationFilter";
import { Texture } from "pixi.js";

describe("wrapUnit", () => {
  it("leaves values already in [0,1) unchanged", () => {
    expect(wrapUnit(0)).toBe(0);
    expect(wrapUnit(0.4)).toBeCloseTo(0.4);
  });

  it("wraps values >= 1 back into [0,1)", () => {
    expect(wrapUnit(1)).toBe(0);
    expect(wrapUnit(1.2)).toBeCloseTo(0.2);
    expect(wrapUnit(3.75)).toBeCloseTo(0.75);
    expect(wrapUnit(1)).toBeLessThan(1);
    expect(wrapUnit(3.75)).toBeLessThan(1);
  });

  it("wraps negative values into [0,1)", () => {
    expect(wrapUnit(-0.25)).toBeCloseTo(0.75);
    expect(wrapUnit(-1.1)).toBeCloseTo(0.9);
  });
});

describe("PlanetRotationFilter", () => {
  it("constructs with a default offset of 0", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    expect(f.offset).toBe(0);
    expect(f.rotationSpeed).toBe(0.001);
  });

  it("increments u_offset by rotationSpeed * dt each frame", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.001 });
    f.advance(100); // 0.001 * 100 = 0.1
    expect(f.offset).toBeCloseTo(0.1);
    f.advance(50); // + 0.05
    expect(f.offset).toBeCloseTo(0.15);
  });

  it("mirrors the offset onto the uOffset uniform", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.002 });
    f.advance(100); // 0.2
    const group = (
      f as unknown as {
        resources: { planetUniforms: { uniforms: { uOffset: number } } };
      }
    ).resources.planetUniforms;
    expect(group.uniforms.uOffset).toBeCloseTo(0.2);
  });

  it("wraps the offset around when it passes 1.0", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: 0.0008 });
    f.advance(1000); // 0.8
    expect(f.offset).toBeCloseTo(0.8);
    f.advance(1000); // 1.6 -> wraps to 0.6
    expect(f.offset).toBeCloseTo(0.6);
    expect(f.offset).toBeGreaterThanOrEqual(0);
    expect(f.offset).toBeLessThan(1);
  });

  it("wraps negative rotation speed into [0,1)", () => {
    const f = new PlanetRotationFilter({ rotationSpeed: -0.001 });
    f.advance(100); // -0.1 -> wraps to 0.9
    expect(f.offset).toBeCloseTo(0.9);
    expect(f.offset).toBeGreaterThanOrEqual(0);
    expect(f.offset).toBeLessThan(1);
  });

  it("accepts an explicit equirectangular texture", () => {
    const f = new PlanetRotationFilter({
      texture: Texture.EMPTY,
      rotationSpeed: 0.001,
      rimStrength: 0.5,
    });
    expect(f).toBeInstanceOf(PlanetRotationFilter);
  });

  describe("disc-coordinate invariant (F1: rectangles regression)", () => {
    const filter = () => new PlanetRotationFilter({ rotationSpeed: 0.001 });

    it("vertex shader emits the aPosition-based vPos varying", () => {
      const vertex = filter().glProgram.vertex;
      expect(vertex).toMatch(/out\s+vec2\s+vPos\s*;/);
      expect(vertex).toMatch(/vPos\s*=\s*aPosition\s*;/);
    });

    it("fragment shader derives disc coords from vPos, not vTextureCoord", () => {
      const fragment = filter().glProgram.fragment;
      expect(fragment).toMatch(/in\s+vec2\s+vPos\s*;/);
      expect(fragment).toMatch(/\(\s*vPos\s*-\s*0\.5\s*\)\s*\*\s*2\.0/);
      expect(fragment).not.toMatch(/vTextureCoord\s*-\s*0\.5/);
    });

    it("does not clip the filter frame to the viewport (vPos must span the full sprite)", () => {
      expect(filter().clipToViewport).toBe(false);
    });
  });
});

describe("createPlanetRotationFilter", () => {
  it("returns a filter for a valid texture", () => {
    const f = createPlanetRotationFilter(Texture.EMPTY, 0.0005);
    expect(f).toBeInstanceOf(PlanetRotationFilter);
    expect(f?.rotationSpeed).toBe(0.0005);
  });
});
