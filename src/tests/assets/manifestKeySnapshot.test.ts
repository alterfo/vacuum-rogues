/**
 * Manifest key-parity baseline (WebP conversion, Task 1).
 *
 * The WebP conversion (`tools/optimize-assets.ts`) is only safe because the
 * manifest keys by path WITHOUT the extension, so swapping `x.png` → `x.webp`
 * must leave the EXACT same key set. `manifestKeys.snapshot.json` captures that
 * key set as the pre-conversion baseline; this test asserts the live manifest
 * still exposes every snapshotted key (and no extras). It must stay green
 * before AND after conversion — a diff here means a caller would break.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { textures } from "@/assets/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const snapshot: string[] = JSON.parse(
  readFileSync(join(here, "manifestKeys.snapshot.json"), "utf8"),
) as string[];

describe("asset manifest — key-parity snapshot", () => {
  const liveKeys = Object.keys(textures).sort();

  it("the snapshot is a non-empty baseline", () => {
    expect(snapshot.length).toBeGreaterThan(100);
  });

  it("every snapshotted key still resolves in the live manifest", () => {
    const missing = snapshot.filter((k) => textures[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("the live manifest introduces no keys absent from the snapshot", () => {
    const baseline = new Set(snapshot);
    const extra = liveKeys.filter((k) => !baseline.has(k));
    expect(extra).toEqual([]);
  });

  it("live key set exactly equals the snapshot", () => {
    expect(liveKeys).toEqual([...snapshot].sort());
  });
});
