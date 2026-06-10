import { describe, it, expect } from "vitest";
import type { Container as PixiContainer } from "pixi.js";
import { Texture } from "pixi.js";
import { PlanetSprite, buildTilingDisc } from "@/presentation/PlanetSprite";
import { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";

// Minimal Market stub so Planet can be constructed without real infrastructure.
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

/** Collect every display object in the subtree that has a `.mask` assigned. */
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
  // PixiJS 8 only clips with a mask that lives in the scene graph. If a mask
  // Graphics is created and assigned to `.mask` but never added to the tree, the
  // masked object falls back to its full rectangular bounds — the "planets render
  // as rectangles" bug. Guard the invariant: every mask is a child of the object
  // it masks.
  it("parents every mask under the object it masks", () => {
    const sprite = new PlanetSprite(
      makePlanet(PlanetType.TERRESTRIAL),
      0,
      0,
      0,
    );
    sprite.render();

    const masked = collectMaskedObjects(sprite.container);

    // The procedural sphere fallback masks both the rotating surface strip and
    // the day/night shading layer, so there must be at least one masked object
    // for this assertion to be meaningful.
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
    // Without render() the loop above asserted nothing (no masks existed). At
    // least one planet type must produce a masked body for this test to bite.
    expect(totalMasked).toBeGreaterThan(0);
  });
});

describe("buildTilingDisc circular mask (equirect fallback)", () => {
  // Regression guard for the "planet renders as a rectangle clipped at a straight
  // edge" bug. The TilingSprite fallback used to parent its circular mask under
  // the TilingSprite itself, whose specialised renderer drops a child mask, so
  // the disc was never clipped. The mask must instead be a child of the plain
  // wrapper Container (the masked object) and centred on the planet origin.
  it("masks the disc with a circle centred on the planet origin (0, 0)", () => {
    const radius = 80;
    const { surface, tiling, mask } = buildTilingDisc(Texture.WHITE, radius);

    // The mask is a child of the wrapper Container and is assigned as its mask;
    // it is never a child of the TilingSprite (whose renderer would drop it).
    expect(surface.children).toContain(mask);
    expect(surface.mask).toBe(mask);
    expect(tiling.children).not.toContain(mask);

    // The mask circle's local bounds span -radius..+radius on both axes, so its
    // centre sits exactly on the planet origin (0, 0).
    const b = mask.getLocalBounds();
    expect(b.x + b.width / 2).toBeCloseTo(0);
    expect(b.y + b.height / 2).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(radius * 2);
    expect(b.height).toBeCloseTo(radius * 2);

    // The TilingSprite is offset so its top-left sits at (-radius, -radius),
    // i.e. the disc is centred on the same origin as the mask.
    expect(tiling.x).toBe(-radius);
    expect(tiling.y).toBe(-radius);

    surface.destroy({ children: true });
  });
});

describe("PlanetSprite.e2eMaskInfo", () => {
  it("returns null when the planet did not take the tiling-disc fallback", () => {
    // In the unit environment no equirect map texture is cached, so the planet
    // never reaches the TilingSprite path; e2eMaskInfo reports null.
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
