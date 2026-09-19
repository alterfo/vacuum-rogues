import { Texture } from "pixi.js";
import { hashStr } from "@/utils/hashStr";
import {
  BLACK_HOLE_EVENT_HORIZON_RADIUS,
  BLACK_HOLE_VISUAL_RADIUS,
} from "@/config/balance";

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
  grad.addColorStop(0.0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.22)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.06)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  dustCached = Texture.from(canvas);
  return dustCached;
}

let starPointCachedNormal: Texture | null | undefined;
let starPointCachedHero: Texture | null | undefined;

export function starPointTexture(hero: boolean): Texture | null {
  const existing = hero ? starPointCachedHero : starPointCachedNormal;
  if (existing !== undefined) return existing;

  const size = hero ? 192 : 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (hero) starPointCachedHero = null;
    else starPointCachedNormal = null;
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
  if (hero) starPointCachedHero = tex;
  else starPointCachedNormal = tex;
  return tex;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

export const ROCK_VARIANT_COUNT = 16;
const rockCache = new Map<number, Texture | null>();

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

  const sides = 7 + Math.floor(rng() * 5); // 7..11
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2;
    const rr = baseR * (0.52 + rng() * 0.62);
    pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < sides; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.clip();

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

  const craters = 2 + Math.floor(rng() * 5); // 2..6
  for (let i = 0; i < craters; i++) {
    const x = cx + (rng() - 0.5) * baseR * 1.3;
    const y = cy + (rng() - 0.5) * baseR * 1.3;
    const cr = baseR * (0.1 + rng() * 0.24);
    const depth = 0.18 + rng() * 0.26;
    ctx.fillStyle = `rgba(0,0,0,${depth.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${(0.08 + rng() * 0.1).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x - cr * 0.15, y - cr * 0.15, cr, Math.PI * 0.9, Math.PI * 1.95);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < sides; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  const rimGrad = ctx.createLinearGradient(
    cx - baseR,
    cy - baseR,
    cx + baseR,
    cy + baseR,
  );
  rimGrad.addColorStop(0.0, "rgba(255,255,255,0.5)");
  rimGrad.addColorStop(0.5, "rgba(255,255,255,0.05)");
  rimGrad.addColorStop(1.0, "rgba(0,0,0,0.35)");
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const tex = Texture.from(canvas);
  rockCache.set(variant, tex);
  return tex;
}

export const NEBULA_VARIANT_COUNT = 8;
const nebulaCache = new Map<number, Texture | null>();

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

  const coreR = size * 0.16;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  coreGrad.addColorStop(0.0, "rgba(255,255,255,0.9)");
  coreGrad.addColorStop(0.5, "rgba(255,255,255,0.5)");
  coreGrad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

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

const blackHoleCache = new Map<string, Texture | null>();

export function blackHoleTexture(seed: string): Texture | null {
  const existing = blackHoleCache.get(seed);
  if (existing !== undefined) return existing;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    blackHoleCache.set(seed, null);
    return null;
  }

  const rng = mulberry32(hashStr(seed));
  const cx = size / 2;
  const cy = size / 2;
  const coreFraction =
    BLACK_HOLE_VISUAL_RADIUS > 0
      ? BLACK_HOLE_EVENT_HORIZON_RADIUS / BLACK_HOLE_VISUAL_RADIUS
      : 0.7;
  const coreR = (size / 2) * coreFraction;
  const diskR = size / 2;

  const disk = ctx.createRadialGradient(cx, cy, coreR, cx, cy, diskR);
  disk.addColorStop(0.0, "rgba(255, 188, 110, 0.95)");
  disk.addColorStop(0.25, "rgba(226, 122, 62, 0.8)");
  disk.addColorStop(0.55, "rgba(120, 62, 54, 0.45)");
  disk.addColorStop(1.0, "rgba(8, 6, 18, 0)");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(cx, cy, diskR, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, diskR - 2, 0, Math.PI * 2);
  ctx.clip();
  const streaks = 10 + Math.floor(rng() * 8);
  for (let i = 0; i < streaks; i++) {
    const ang = rng() * Math.PI * 2;
    const start = coreR + rng() * (diskR - coreR) * 0.25;
    const end = diskR * (0.75 + rng() * 0.25);
    const grad = ctx.createLinearGradient(
      cx + Math.cos(ang) * start,
      cy + Math.sin(ang) * start,
      cx + Math.cos(ang) * end,
      cy + Math.sin(ang) * end,
    );
    grad.addColorStop(
      0.0,
      `rgba(255, 200, 120, ${(0.1 + rng() * 0.14).toFixed(3)})`,
    );
    grad.addColorStop(1.0, "rgba(255, 200, 120, 0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2 + rng() * 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * start, cy + Math.sin(ang) * start);
    ctx.lineTo(cx + Math.cos(ang) * end, cy + Math.sin(ang) * end);
    ctx.stroke();
  }
  ctx.restore();

  const core = ctx.createRadialGradient(cx, cy, coreR * 0.6, cx, cy, coreR);
  core.addColorStop(0.0, "rgba(4, 4, 10, 1)");
  core.addColorStop(0.86, "rgba(4, 4, 10, 1)");
  core.addColorStop(0.94, "rgba(150, 130, 220, 0.35)");
  core.addColorStop(1.0, "rgba(150, 130, 220, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  const tex = Texture.from(canvas);
  blackHoleCache.set(seed, tex);
  return tex;
}
