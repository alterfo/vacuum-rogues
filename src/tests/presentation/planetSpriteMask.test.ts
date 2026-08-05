import { describe, it, expect } from "vitest";
import type { Container as PixiContainer } from "pixi.js";
import { Texture } from "pixi.js";
import { PlanetSprite, buildTilingDisc } from "@/presentation/PlanetSprite";
import { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";

const stubMarket = {
  goods: [],
  getPrice: () => 0,
  updatePrices: () => {},
} as unknown as import("@/domain/Market").Market;

function makePlanet(type: PlanetType): Planet {
  return new Planet(
    "p-mask",
    "Маскотест",
    type,
    800,
    stubMarket,
    [],
    [],
    true,
    0,
    0,
    null,
  );
}

function collectMaskedObjects(root: PixiContainer): PixiContainer[] {
  const out: PixiContainer[] = [];
  const visit = (node: PixiContainer): void => {
    if (node.mask) out.push(node);
    for (const child of node.children as PixiContainer[]) visit(child);
  };
  visit(root);
  return out;
}

describe("PlanetSprite circular masking", () => {
  it("parents every mask under the object it masks", () => {
    const sprite = new PlanetSprite(
      makePlanet(PlanetType.TERRESTRIAL),
      0,
      0,
      0,
    );
    sprite.render();

    const masked = collectMaskedObjects(sprite.container);

    expect(masked.length).toBeGreaterThan(0);

    for (const obj of masked) {
      const mask = obj.mask as unknown as PixiContainer;
      expect(obj.children).toContain(mask);
    }

    sprite.destroy();
  });

  it("masks every planet type's body to a circle", () => {
    let totalMasked = 0;
    for (const type of Object.values(PlanetType)) {
      const sprite = new PlanetSprite(makePlanet(type), 0, 0, 0);
      sprite.render(); // masks are only assigned during render()
      const masked = collectMaskedObjects(sprite.container);
      totalMasked += masked.length;
      for (const obj of masked) {
        const mask = obj.mask as unknown as PixiContainer;
        expect(obj.children).toContain(mask);
      }
      sprite.destroy();
    }
    expect(totalMasked).toBeGreaterThan(0);
  });
});

describe("buildTilingDisc circular mask (equirect fallback)", () => {
  it("masks the disc with a circle centred on the planet origin (0, 0)", () => {
    const radius = 80;
    const { surface, tiling, mask } = buildTilingDisc(Texture.WHITE, radius);

    expect(surface.children).toContain(mask);
    expect(surface.mask).toBe(mask);
    expect(tiling.children).not.toContain(mask);

    const b = mask.getLocalBounds();
    expect(b.x + b.width / 2).toBeCloseTo(0);
    expect(b.y + b.height / 2).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(radius * 2);
    expect(b.height).toBeCloseTo(radius * 2);

    expect(tiling.x).toBe(-radius);
    expect(tiling.y).toBe(-radius);

    surface.destroy({ children: true });
  });
});

describe("PlanetSprite.e2eMaskInfo", () => {
  it("returns null when the planet did not take the tiling-disc fallback", () => {
    const sprite = new PlanetSprite(
      makePlanet(PlanetType.TERRESTRIAL),
      0,
      0,
      0,
    );
    expect(sprite.e2eMaskInfo()).toBeNull();
    sprite.destroy();
  });
});
