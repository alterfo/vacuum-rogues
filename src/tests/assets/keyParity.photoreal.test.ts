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
