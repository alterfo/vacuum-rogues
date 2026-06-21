/**
 * UI + icon WebP key-parity (Task 3).
 *
 * Task 3 converts the UI categories (`ui`, `icons`) from PNG to LOSSLESS WebP and
 * deletes the originals. Lossless is chosen so flat colour, crisp edges, and
 * transparency survive (lossy WebP would ring around edges and muddy alpha).
 * Because `manifest.ts` keys by path WITHOUT the extension, that swap must leave
 * the EXACT same key set. This test asserts, for `ui`/`icons` only, that
 * (a) every key the pre-conversion snapshot captured still resolves in the live
 * manifest, (b) no PNG/JPG files remain on disk — every source is now `.webp`,
 * and (c) alpha is preserved (a sample with transparency keeps its alpha channel).
 *
 * Photoreal categories are converted separately (Task 2) and are NOT asserted here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { textures } from "@/assets/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const assetsRoot = join(here, "..", "..", "assets");

const snapshot: string[] = JSON.parse(
  readFileSync(join(here, "manifestKeys.snapshot.json"), "utf8"),
) as string[];

/** Categories converted to lossless WebP in Task 3. */
const UI_CATEGORIES = ["ui", "icons"] as const;

/** Recursively collect lowercase file extensions under `dir`. */
function listExtensions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...listExtensions(abs));
    else out.push(extname(entry).toLowerCase());
  }
  return out;
}

describe("ui + icons — WebP key-parity (Task 3)", () => {
  const uiKeys = snapshot.filter((k) =>
    (UI_CATEGORIES as readonly string[]).includes(k.split("/")[0] ?? ""),
  );

  it("the snapshot actually contains ui/icon keys", () => {
    expect(uiKeys.length).toBeGreaterThan(0);
  });

  it("every snapshotted ui/icon key still resolves in the live manifest", () => {
    const missing = uiKeys.filter((k) => textures[k] === undefined);
    expect(missing).toEqual([]);
  });

  it.each(UI_CATEGORIES)(
    "%s contains only .webp images (no PNG/JPG remain)",
    (category) => {
      const exts = listExtensions(join(assetsRoot, category)).filter((e) =>
        [".png", ".jpg", ".jpeg", ".webp"].includes(e),
      );
      expect(exts.filter((e) => e !== ".webp")).toEqual([]);
    },
  );

  it("resolves to WebP urls for ui/icon keys", () => {
    for (const k of uiKeys) {
      expect(textures[k]).toMatch(/\.webp(\?|$)/i);
    }
  });

  it("preserves alpha — a transparent UI source stays WebP with an alpha channel", async () => {
    // cursor_default has transparency; lossless conversion must keep its alpha.
    const cursor = join(assetsRoot, "ui", "cursor_default.webp");
    expect(existsSync(cursor)).toBe(true);
    const meta = await sharp(cursor).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
  });
});
