import { describe, it, expect } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import { buildSphereMesh } from "@/presentation/sphereMesh";

/**
 * F4 (letsplay 2026-06-10): the sun showed a hard discontinuity seam on its
 * disc. The sphere mesh sampled the equirect map with plain "repeat"
 * addressing on BOTH axes: the texture's non-tiling left/right edges met in a
 * hard meridian seam that swept the disc as the sun rotated, and the pole rows
 * blended with the opposite edge. Mirror-repeat on U makes the wrap continuous
 * for any texture; clamp on V stops the pole bleed. jsdom cannot execute the
 * GPU sampling, so these tests pin the addressing configuration and the
 * matching longitude wrap period at the source level.
 */

function makeTexture(): Texture {
  // A fresh TextureSource so the style mutation never leaks into the shared
  // Texture.WHITE used by other tests.
  return new Texture({ source: new TextureSource({ width: 8, height: 4 }) });
}

describe("buildSphereMesh texture addressing (F4 sun seam)", () => {
  it("uses mirror-repeat on U so the equirect wrap seam never shows as a hard meridian", () => {
    const tex = makeTexture();
    // Guard: a null (failed) build returns before the style mutation, which
    // would make this assertion pass vacuously against the default mode.
    expect(buildSphereMesh(tex, 100)).not.toBeNull();
    expect(tex.source.style.addressModeU).toBe("mirror-repeat");
  });

  it("clamps V so the pole rows do not blend with the opposite texture edge", () => {
    const tex = makeTexture();
    expect(buildSphereMesh(tex, 100)).not.toBeNull();
    expect(tex.source.style.addressModeV).toBe("clamp-to-edge");
  });

  it("advance() wraps longitude with period 2 to match the mirror period (no pop at wrap)", () => {
    const sphere = buildSphereMesh(makeTexture(), 100);
    expect(sphere).not.toBeNull();

    // First vertex sits at lon = -90° → baseU = 0.25. After a full forward
    // turn the mirrored half of the period must play (u = 1.25), not snap back
    // to the original image (u = 0.25) — that snap was a visible pop.
    sphere!.advance(1);
    const uvs = sphere!.mesh.geometry.getBuffer("aUV")!.data as Float32Array;
    expect(uvs[0]).toBeCloseTo(1.25);

    // After two full turns the cycle restarts seamlessly at the original image.
    sphere!.advance(1);
    expect(uvs[0]).toBeCloseTo(0.25);
  });
});
