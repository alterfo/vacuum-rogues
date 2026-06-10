/**
 * Equirectangular texture → rotating-sphere mesh (US-070 #4 / planets).
 *
 * Builds a textured mesh whose vertices lie on the orthographic projection of a
 * sphere's front hemisphere, so the texture compresses toward the limb and rolls
 * off the edge as the surface turns — a real rotating-sphere look, not a flat
 * scroll. Rotation is animated by shifting every vertex's longitude (u) via
 * {@link SphereMesh.advance}. Used for both the sun and (map-backed) planets.
 *
 * Pure presentation helper; uses only the built-in textured-mesh renderer (no
 * custom GLSL), so it's robust across PixiJS builds. Returns null on any API
 * mismatch so callers can fall back to a flat scroll.
 */
import { Mesh, MeshGeometry } from "pixi.js";
import type { Buffer, Texture } from "pixi.js";

export interface SphereMesh {
  readonly mesh: Mesh;
  /** Roll the surface by a longitude delta (fraction of a full turn; wraps). */
  advance(lonDelta: number): void;
}

export function buildSphereMesh(
  mapTex: Texture,
  radius: number,
  tint = 0xffffff,
): SphereMesh | null {
  try {
    const cols = 48; // longitude segments
    const rows = 24; // latitude segments
    const HALF_PI = Math.PI / 2;
    const vCount = (cols + 1) * (rows + 1);
    const positions = new Float32Array(vCount * 2);
    const uvs = new Float32Array(vCount * 2);
    const baseU = new Float32Array(vCount);

    let p = 0;
    for (let j = 0; j <= rows; j++) {
      const lat = -HALF_PI + Math.PI * (j / rows);
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const v = lat / Math.PI + 0.5;
      for (let i = 0; i <= cols; i++) {
        const lon = -HALF_PI + Math.PI * (i / cols); // front hemisphere
        positions[p * 2] = radius * cosLat * Math.sin(lon);
        positions[p * 2 + 1] = radius * sinLat;
        const u = lon / (Math.PI * 2) + 0.5;
        baseU[p] = u;
        uvs[p * 2] = u;
        uvs[p * 2 + 1] = v;
        p++;
      }
    }

    const indices = new Uint32Array(cols * rows * 6);
    let k = 0;
    const stride = cols + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = c;
      }
    }

    const geometry = new MeshGeometry({ positions, uvs, indices });
    const uvBuffer: Buffer | null = geometry.getBuffer("aUV");
    if (!uvBuffer) return null;

    // Mirror-wrap horizontally so the longitude offset scrolls past the seam
    // without a hard discontinuity even when the map's left/right edges don't
    // tile (F4: plain "repeat" showed the mismatched edges as a seam meridian
    // sweeping the rotating sun). Clamp vertically so the pole rows never
    // blend with the opposite edge of the texture. This applies to BOTH bodies
    // sharing this helper — the sun and map-backed planets: on planets the
    // mirrored half of each rotation cycle is invisible on the procedural
    // equirect maps, while the old hard seam meridian was not.
    //
    // Mutate the shared texture style only after geometry validation above, so
    // a failed build (null return → TilingSprite fallback) has no side effects
    // on other consumers of the same cached texture.
    try {
      const style = mapTex.source?.style as
        | { addressModeU?: string; addressModeV?: string }
        | undefined;
      if (style) {
        style.addressModeU = "mirror-repeat";
        style.addressModeV = "clamp-to-edge";
        (mapTex.source.style as { update?: () => void }).update?.();
      }
    } catch {
      /* wrap mode is best-effort */
    }

    const mesh = new Mesh({ geometry, texture: mapTex });
    mesh.tint = tint;
    mesh.eventMode = "none";

    // Longitude wraps with period 2, not 1: mirror-repeat addressing repeats
    // the texture every TWO widths (image + its mirror), so wrapping at 1
    // would snap the mirrored half back to the original mid-cycle — a visible
    // pop. With period 2 the u offset is continuous across the whole cycle.
    let lon = 0;
    return {
      mesh,
      advance(lonDelta: number): void {
        lon = (lon + lonDelta) % 2;
        if (lon < 0) lon += 2;
        for (let i = 0; i < baseU.length; i++) uvs[i * 2] = baseU[i] + lon;
        uvBuffer.update();
      },
    };
  } catch {
    return null;
  }
}
