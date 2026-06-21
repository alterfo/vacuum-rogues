/**
 * WebP conversion tool (Task 1) — pure option selection + a real round-trip.
 *
 * Guards the two testable pieces of `tools/optimize-assets.ts`:
 *   (a) `webpOptionsFor(category)` picks lossy ~q80 for photoreal categories
 *       and lossless for ui/icons (alpha always preserved);
 *   (b) a fixture PNG → WebP conversion yields a valid WebP that is smaller
 *       and keeps the source dimensions, then removes the original.
 *
 * Lives under `tools/` (not `src/tests/`) like the other tool tests
 * (`scaffold/domain-field.test.ts`) because importing a `tools/` module from
 * `src/` would violate the build's `rootDir: src`. Vitest's tools glob
 * (see vitest.config `include`) picks it up, so it runs with the suite.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  PHOTOREAL_CATEGORIES,
  PHOTOREAL_QUALITY,
  UI_CATEGORIES,
  categoryOf,
  convertFile,
  webpOptionsFor,
} from "./optimize-assets";

/** First image-data chunk fourcc of a RIFF/WebP file: "VP8L" = lossless, "VP8 " = lossy. */
function webpImageChunks(path: string): string[] {
  const b = readFileSync(path);
  const chunks: string[] = [];
  let off = 12; // skip RIFF header + "WEBP"
  while (off + 8 <= b.length && chunks.length < 20) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    chunks.push(id);
    off += 8 + size + (size & 1); // chunks are padded to even length
  }
  return chunks;
}

describe("webpOptionsFor — per-category quality", () => {
  it("returns lossy ~q80 for every photoreal category", () => {
    for (const cat of PHOTOREAL_CATEGORIES) {
      const opts = webpOptionsFor(cat);
      expect(opts.lossless).toBe(false);
      expect(opts.quality).toBe(PHOTOREAL_QUALITY);
      expect(opts.quality).toBeGreaterThanOrEqual(75);
      expect(opts.quality).toBeLessThanOrEqual(85);
    }
  });

  it("returns lossless for ui + icons", () => {
    for (const cat of UI_CATEGORIES) {
      const opts = webpOptionsFor(cat);
      expect(opts.lossless).toBe(true);
    }
  });

  it("always preserves full alpha", () => {
    for (const cat of [...PHOTOREAL_CATEGORIES, ...UI_CATEGORIES]) {
      expect(webpOptionsFor(cat).alphaQuality).toBe(100);
    }
  });

  it("defaults an unknown category to the lossy photoreal preset", () => {
    const opts = webpOptionsFor("totally_unknown");
    expect(opts.lossless).toBe(false);
    expect(opts.quality).toBe(PHOTOREAL_QUALITY);
  });
});

describe("categoryOf — first path segment", () => {
  it("extracts the leading directory as the category", () => {
    expect(categoryOf("nebula/red_mid.png")).toBe("nebula");
    expect(categoryOf("ui/cursor.png")).toBe("ui");
  });
});

describe("convertFile — fixture PNG → WebP round-trip", () => {
  let dir: string;
  const WIDTH = 256;
  const HEIGHT = 192;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "webp-fixture-"));
    // mulberry32 PRNG → genuinely incompressible RGB noise: PNG (lossless) must
    // store it all (large) while lossy WebP discards the imperceptible detail
    // (smaller) — a deterministic "smaller" assertion. (An LCG's low byte cycles
    // with a short period and compresses well, defeating the test.)
    let s = 0x9e3779b9 >>> 0;
    const rnd = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) & 0xff;
    };
    const px = WIDTH * HEIGHT * 3;
    const raw = Buffer.allocUnsafe(px);
    for (let i = 0; i < px; i++) raw[i] = rnd();
    await sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
      .png()
      .toFile(join(dir, "noise.png"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces a valid, smaller WebP with the same dimensions and removes the original", async () => {
    const src = join(dir, "noise.png");
    const res = await convertFile(src, "planets");
    expect(res).toBeDefined();
    if (!res) return;

    // Output exists, source removed.
    expect(existsSync(res.dest)).toBe(true);
    expect(res.dest.endsWith(".webp")).toBe(true);
    expect(existsSync(src)).toBe(false);

    // Valid WebP, dimensions preserved.
    const meta = await sharp(res.dest).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(WIDTH);
    expect(meta.height).toBe(HEIGHT);

    // The on-disk file is byte-for-byte the verified buffer (destBytes). A
    // regression guard against re-encoding the buffer on write (which would
    // make the file size diverge from destBytes and discard the chosen encode).
    expect(statSync(res.dest).size).toBe(res.destBytes);

    // Materially smaller.
    expect(res.destBytes).toBeLessThan(res.srcBytes);
  });

  it("writes a LOSSLESS WebP for the ui category (not a lossy re-encode)", async () => {
    // Regression: the writer must preserve webpOptionsFor("ui").lossless. A
    // re-encode through sharp on write would silently emit a lossy "VP8 " chunk.
    const W = 16;
    const H = 16;
    const raw = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      raw[i * 4 + 0] = 12;
      raw[i * 4 + 1] = 200;
      raw[i * 4 + 2] = 64;
      raw[i * 4 + 3] = 255;
    }
    const src = join(dir, "lossless_ui.png");
    await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
      .png()
      .toFile(src);

    const res = await convertFile(src, "ui");
    expect(res).toBeDefined();
    if (!res) return;

    expect(webpOptionsFor("ui").lossless).toBe(true);
    const chunks = webpImageChunks(res.dest);
    expect(chunks).toContain("VP8L");
    expect(chunks).not.toContain("VP8 ");
  });

  it("preserves the alpha channel through conversion", async () => {
    // A semi-transparent RGBA square; lossless ui preset must keep alpha.
    const W = 32;
    const H = 32;
    const raw = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      raw[i * 4 + 0] = 200;
      raw[i * 4 + 1] = 100;
      raw[i * 4 + 2] = 50;
      raw[i * 4 + 3] = 128; // half-transparent
    }
    const src = join(dir, "alpha.png");
    await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
      .png()
      .toFile(src);

    const res = await convertFile(src, "ui");
    expect(res).toBeDefined();
    if (!res) return;

    const meta = await sharp(res.dest).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it("dry-run writes nothing and deletes nothing", async () => {
    // The tool deletes originals; --dry-run must be a true no-op on disk.
    const W = 16;
    const H = 16;
    const raw = Buffer.alloc(W * H * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) & 0xff;
    const src = join(dir, "dryrun.png");
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(src);

    const res = await convertFile(src, "planets", true);
    expect(res).toBeDefined();
    if (!res) return;

    // Source intact, no .webp written, but destBytes is still the real size.
    expect(existsSync(src)).toBe(true);
    expect(existsSync(res.dest)).toBe(false);
    expect(res.destBytes).toBeGreaterThan(0);
  });

  it("returns undefined for a non-convertible (already webp) path", async () => {
    const out = await convertFile(join(dir, "already.webp"), "planets");
    expect(out).toBeUndefined();
  });
});
