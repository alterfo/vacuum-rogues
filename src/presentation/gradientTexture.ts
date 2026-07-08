import { Texture } from "pixi.js";

/**
 * Soft-glow texture for the flight scene's nebula / sun halo / absorption
 * pillars (per-instance planet/star variety + FPS work, 2026-06-12).
 *
 * A single white radial-gradient texture (bright centre → transparent edge) is
 * baked ONCE via Canvas2D and shared by every soft element: tint + scale + alpha
 * + blendMode a `Sprite` of it to get a smooth glow with **zero per-frame cost**
 * — replacing the per-frame `BlurFilter`s that dragged the flight scene to ~15
 * FPS. (A stacked-`Graphics` fallback handles the no-canvas case, but it bands.)
 *
 * Returns `null` when no 2D canvas context is available (jsdom / unit tests) so
 * callers fall back to a `Graphics` approximation instead of crashing.
 */
let cached: Texture | null | undefined;

export function softGlowTexture(): Texture | null {
  if (cached !== undefined) return cached;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cached = null;
    return null;
  }

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Bright concentrated centre fading smoothly to nothing — the falloff a
  // strength-72/80 blur produced, baked once.
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.6)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.1)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  cached = Texture.from(canvas);
  return cached;
}

/**
 * Soft dust-mote texture for the comet particle tail (natural-comet rework,
 * 2026-06-20). A small, very diffuse white radial dot — no hard core — baked
 * ONCE so a `ParticleContainer` of tinted/scaled/faded `Sprite`s of it reads as
 * a soft volumetric dust trail with **zero per-frame cost** (no `BlurFilter`,
 * per `feedback-no-blur-filters-flight`). Returns `null` with no 2D context
 * (jsdom / unit tests) so callers fall back without crashing.
 */
let dustCached: Texture | null | undefined;

export function dustParticleTexture(): Texture | null {
  if (dustCached !== undefined) return dustCached;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    dustCached = null;
    return null;
  }

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // No bright core — a faint, soft mote that fully fades by the edge so many
  // overlapping copies accumulate into a smooth diffuse cloud, not hard dots.
  grad.addColorStop(0.0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.22)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.06)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  dustCached = Texture.from(canvas);
  return dustCached;
}

/**
 * Baked, tintable star-point texture for the background twinkle stars
 * (space-visual-cleanup, 2026-07-08). Replaces the runtime `Graphics`
 * 4-point diffraction-spike stroke (a crisp vector plus-sign) with a
 * Canvas2D-baked tight bright core + smooth falloff; when `hero` is true, two
 * soft, tapered, low-alpha glints are baked directly into the gradient canvas
 * as anti-aliased linear-gradient strokes, so they read as a photographic
 * lens glint rather than a hard-edged cross. Callers tint a `Sprite` of this
 * per-star (white base, like `softGlowTexture`), so one texture serves every
 * star colour. Cached per `hero` value (baked once). Returns `null` with no 2D
 * context (jsdom / unit tests) so callers fall back to a plain `Graphics` dot.
 */
const starPointCache = new Map<boolean, Texture | null>();

export function starPointTexture(hero: boolean): Texture | null {
  const existing = starPointCache.get(hero);
  if (existing !== undefined) return existing;

  const size = hero ? 192 : 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    starPointCache.set(hero, null);
    return null;
  }

  const cx = size / 2;
  const cy = size / 2;

  if (hero) {
    const armLen = size * 0.46;
    const drawGlint = (dx: number, dy: number) => {
      const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      grad.addColorStop(0.0, "rgba(255,255,255,0)");
      grad.addColorStop(0.42, "rgba(255,255,255,0.05)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.22)");
      grad.addColorStop(0.58, "rgba(255,255,255,0.05)");
      grad.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.stroke();
    };
    drawGlint(armLen, 0);
    drawGlint(0, armLen);
  }

  // Tight bright core with smooth falloff — the point-light look a real star
  // photographs with, drawn over the glint tails so the core stays the
  // brightest, sharpest feature.
  const coreR = size * 0.5;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.1)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = Texture.from(canvas);
  starPointCache.set(hero, tex);
  return tex;
}

/**
 * Deterministic small PRNG (mulberry32) so a given rock `seed` always bakes the
 * same rock — distinct seeds give distinct rocks, identical seeds reuse the
 * cached texture.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Baked comet-head texture (space-visual-cleanup, 2026-07-08). Replaces
 * `setupCometVisuals`' reuse of the generic `softGlowTexture` glow — a
 * symmetric blob with no distinct centre, giving comets the same shapeless,
 * muddy look as the nebula clouds — with a texture built for a comet nucleus:
 * a sharp, bright pinpoint core (tighter falloff than `softGlowTexture`'s)
 * plus a softer coma offset toward one side (solar-heating asymmetry) instead
 * of a perfectly round halo, so the head reads as a coherent object with a
 * clear bright centre. Baked ONCE and cached (like `softGlowTexture`/
 * `dustParticleTexture`) so callers tint/scale a `Sprite` of it with zero
 * per-frame cost. Returns `null` with no 2D context (jsdom / unit tests) so
 * callers fall back to the existing minimal drawn nucleus.
 */
let cometHeadCached: Texture | null | undefined;

export function cometHeadTexture(): Texture | null {
  if (cometHeadCached !== undefined) return cometHeadCached;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cometHeadCached = null;
    return null;
  }

  const cx = size / 2;
  const cy = size / 2;

  // Asymmetric coma: offset toward one side (away from the sun-facing edge)
  // rather than a perfectly centred halo, so the head isn't a uniform circle.
  const comaOffsetX = size * 0.1;
  const comaR = size * 0.46;
  const comaGrad = ctx.createRadialGradient(
    cx + comaOffsetX,
    cy,
    0,
    cx + comaOffsetX,
    cy,
    comaR,
  );
  comaGrad.addColorStop(0.0, "rgba(255,255,255,0.55)");
  comaGrad.addColorStop(0.4, "rgba(255,255,255,0.22)");
  comaGrad.addColorStop(0.75, "rgba(255,255,255,0.07)");
  comaGrad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = comaGrad;
  ctx.fillRect(0, 0, size, size);

  // Sharp, bright pinpoint nucleus — a tighter falloff than softGlowTexture's
  // generic core, so the centre stays a distinct hot point, not a blur.
  const coreR = size * 0.22;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  coreGrad.addColorStop(0.0, "rgba(255,255,255,1)");
  coreGrad.addColorStop(0.15, "rgba(255,255,255,0.95)");
  coreGrad.addColorStop(0.4, "rgba(255,255,255,0.4)");
  coreGrad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, size, size);

  cometHeadCached = Texture.from(canvas);
  return cometHeadCached;
}

/** How many distinct rock textures are baked; seeds wrap onto this set. */
export const ROCK_VARIANT_COUNT = 8;
const rockCache = new Map<number, Texture | null>();

/**
 * Baked, shaded rock-texture sprite for the foreground asteroids (natural-comet
 * /asteroid rework, 2026-06-20). Replaces the flat `poly`+crater `Graphics`
 * rocks with an irregular grey rock lit from the top-left (radial gradient),
 * speckled with noise and a few craters — baked ONCE per variant and cached so
 * each asteroid is just a tinted/rotated `Sprite` (no per-frame redraw). The
 * `seed` wraps onto {@link ROCK_VARIANT_COUNT} variants to bound memory.
 * Returns `null` with no 2D context (jsdom / unit tests).
 */
export function rockTexture(seed: number): Texture | null {
  const variant =
    ((Math.trunc(seed) % ROCK_VARIANT_COUNT) + ROCK_VARIANT_COUNT) %
    ROCK_VARIANT_COUNT;
  const existing = rockCache.get(variant);
  if (existing !== undefined) return existing;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    rockCache.set(variant, null);
    return null;
  }

  const rng = mulberry32(0x9e3779b9 ^ ((variant + 1) * 0x85ebca6b));
  const cx = size / 2;
  const cy = size / 2;
  const baseR = size * 0.4;

  // Irregular rock silhouette — a jittered polygon, clipped so the shading and
  // craters stay inside the rock.
  const sides = 9;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2;
    const rr = baseR * (0.66 + rng() * 0.42);
    pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < sides; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.clip();

  // Shaded body: a radial gradient offset toward the top-left light gives a lit
  // highlight fading to a dark shadowed rim — the 3D read the flat fill lacked.
  const lightX = cx - baseR * 0.45;
  const lightY = cy - baseR * 0.45;
  const tone = 88 + Math.floor(rng() * 46); // grey base 88..134
  const hi = (d: number) => Math.min(255, tone + d);
  const lo = (d: number) => Math.max(0, tone - d);
  const grad = ctx.createRadialGradient(
    lightX,
    lightY,
    baseR * 0.1,
    cx,
    cy,
    baseR * 1.3,
  );
  grad.addColorStop(0.0, `rgb(${hi(58)}, ${hi(50)}, ${hi(40)})`);
  grad.addColorStop(0.5, `rgb(${tone}, ${lo(6)}, ${lo(14)})`);
  grad.addColorStop(1.0, `rgb(${lo(58)}, ${lo(62)}, ${lo(66)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Surface speckle — fine light/dark grit breaks the smooth gradient.
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 0.5 + rng() * 1.6;
    ctx.fillStyle =
      rng() < 0.5
        ? `rgba(0,0,0,${(0.04 + rng() * 0.1).toFixed(3)})`
        : `rgba(255,255,255,${(0.03 + rng() * 0.08).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craters — a dark bowl with a light rim catching the top-left light.
  const craters = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < craters; i++) {
    const x = cx + (rng() - 0.5) * baseR * 1.3;
    const y = cy + (rng() - 0.5) * baseR * 1.3;
    const cr = baseR * (0.12 + rng() * 0.2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x - cr * 0.15, y - cr * 0.15, cr, Math.PI * 0.9, Math.PI * 1.95);
    ctx.stroke();
  }
  ctx.restore();

  const tex = Texture.from(canvas);
  rockCache.set(variant, tex);
  return tex;
}

/** How many distinct nebula-cloud textures are baked; seeds wrap onto this set. */
export const NEBULA_VARIANT_COUNT = 8;
const nebulaCache = new Map<number, Texture | null>();

/**
 * Baked, wispy nebula-cloud texture (space-visual-cleanup, 2026-07-08).
 * Replaces the 4 perfectly concentric, uniformly-smooth `softGlowTexture`
 * rings `createNebulae` used to stack — which read as one flat, muddy blob —
 * with a single white (tintable, like `softGlowTexture`) canvas compositing
 * many randomly-offset/-sized soft blobs plus a denser core and fine alpha
 * speckle, so the silhouette has real internal structure. The `seed` wraps
 * onto {@link NEBULA_VARIANT_COUNT} variants to bound memory, cached like
 * `rockTexture`. Returns `null` with no 2D context (jsdom / unit tests) so
 * callers fall back to the existing stacked-`Graphics` approximation.
 */
export function nebulaCloudTexture(seed: number): Texture | null {
  const variant =
    ((Math.trunc(seed) % NEBULA_VARIANT_COUNT) + NEBULA_VARIANT_COUNT) %
    NEBULA_VARIANT_COUNT;
  const existing = nebulaCache.get(variant);
  if (existing !== undefined) return existing;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    nebulaCache.set(variant, null);
    return null;
  }

  const rng = mulberry32(0x2545f491 ^ ((variant + 1) * 0x27d4eb2f));
  const cx = size / 2;
  const cy = size / 2;
  const spread = size * 0.34;

  // Wispy structure: many randomly offset/sized soft blobs at varied alpha —
  // an irregular, non-concentric cloud silhouette instead of stacked rings.
  const blobCount = 10 + Math.floor(rng() * 6);
  for (let i = 0; i < blobCount; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = rng() * rng() * spread;
    const bx = cx + Math.cos(ang) * dist;
    const by = cy + Math.sin(ang) * dist * (0.55 + rng() * 0.3);
    const r = size * (0.12 + rng() * 0.22) * (1 - (dist / spread) * 0.3);
    const alpha = 0.08 + rng() * 0.16;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    grad.addColorStop(0.0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${(alpha * 0.4).toFixed(3)})`);
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bright core — denser and tighter than any single haze blob, giving the
  // cloud a clear luminous centre rather than uniform density throughout.
  const coreR = size * 0.16;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  coreGrad.addColorStop(0.0, "rgba(255,255,255,0.9)");
  coreGrad.addColorStop(0.5, "rgba(255,255,255,0.5)");
  coreGrad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  // Fine alpha-noise speckle — same technique as `rockTexture`'s surface
  // speckle — breaks up any remaining smooth gradient banding.
  for (let i = 0; i < 140; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 0.6 + rng() * 1.8;
    ctx.fillStyle = `rgba(255,255,255,${(0.03 + rng() * 0.06).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = Texture.from(canvas);
  nebulaCache.set(variant, tex);
  return tex;
}
