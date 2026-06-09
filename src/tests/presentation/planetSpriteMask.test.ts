import { describe, it, expect } from "vitest";
import type { Container as PixiContainer } from "pixi.js";
import { PlanetSprite } from "@/presentation/PlanetSprite";
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
    for (const type of Object.values(PlanetType)) {
      const sprite = new PlanetSprite(makePlanet(type), 0, 0, 0);
      const masked = collectMaskedObjects(sprite.container);
      for (const obj of masked) {
        const mask = obj.mask as unknown as PixiContainer;
        expect(obj.children).toContain(mask);
      }
      sprite.destroy();
    }
  });
});
