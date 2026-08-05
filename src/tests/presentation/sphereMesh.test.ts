import { describe, it, expect } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import { buildSphereMesh } from "@/presentation/sphereMesh";

function makeTexture(): Texture {
  return new Texture({ source: new TextureSource({ width: 8, height: 4 }) });
}

describe("buildSphereMesh texture addressing (F4 sun seam)", () => {
  it("uses mirror-repeat on U so the equirect wrap seam never shows as a hard meridian", () => {
    const tex = makeTexture();
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

    sphere!.advance(1);
    const uvs = sphere!.mesh.geometry.getBuffer("aUV")!.data as Float32Array;
    expect(uvs[0]).toBeCloseTo(1.25);

    sphere!.advance(1);
    expect(uvs[0]).toBeCloseTo(0.25);
  });
});
