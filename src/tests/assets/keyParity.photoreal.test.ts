/**
 * Photoreal WebP key-parity (Task 2).
 *
 * Task 2 converts the photoreal categories (nebula, panoramas, planets, …) from
 * PNG/JPG to lossy WebP and deletes the originals. Because `manifest.ts` keys by
 * path WITHOUT the extension, that swap must leave the EXACT same key set. This
 * test asserts, for the converted categories only, that (a) every key the
 * pre-conversion snapshot captured still resolves in the live manifest, and
 * (b) no PNG/JPG files remain on disk — every source is now `.webp`.
 *
 * UI + icons are converted separately (Task 3) and are NOT asserted here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { textures } from "@/assets/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const assetsRoot = join(here, "..", "..", "assets");

const snapshot: string[] = JSON.parse(
  readFileSync(join(here, "manifestKeys.snapshot.json"), "utf8"),
) as string[];

/** Categories converted to lossy WebP in Task 2 (surfaces is empty on disk). */
const PHOTOREAL_CATEGORIES = [
  "nebula",
  "panoramas",
  "planets",
  "planet_maps",
  "stars",
  "star_maps",
  "portraits",
  "ships",
  "player_ships",
] as const;

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

describe("photoreal categories — WebP key-parity (Task 2)", () => {
  const photorealKeys = snapshot.filter((k) =>
    (PHOTOREAL_CATEGORIES as readonly string[]).includes(k.split("/")[0] ?? ""),
  );

  it("the snapshot actually contains photoreal keys", () => {
    expect(photorealKeys.length).toBeGreaterThan(100);
  });

  it("every snapshotted photoreal key still resolves in the live manifest", () => {
    const missing = photorealKeys.filter((k) => textures[k] === undefined);
    expect(missing).toEqual([]);
  });

  it.each(PHOTOREAL_CATEGORIES)(
    "%s contains only .webp images (no PNG/JPG remain)",
    (category) => {
      const exts = listExtensions(join(assetsRoot, category)).filter((e) =>
        [".png", ".jpg", ".jpeg", ".webp"].includes(e),
      );
      expect(exts.filter((e) => e !== ".webp")).toEqual([]);
    },
  );
});
