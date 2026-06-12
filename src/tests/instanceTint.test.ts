import { describe, it, expect } from "vitest";
import { tintFromSeed } from "@/utils/instanceTint";

/**
 * Task 1 (per-instance planet/star variety): `tintFromSeed` must give every
 * planet backdrop a distinct-but-believable tint keyed by `planet.id`.
 * Distinct ids → distinct tints; same id → stable; every channel stays inside
 * a believable band (0.75–1.0 multiplier → byte 191..255), never near-black or
 * neon.
 */
describe("tintFromSeed (per-instance backdrop variation)", () => {
  const channels = (tint: number) => [
    (tint >> 16) & 0xff,
    (tint >> 8) & 0xff,
    tint & 0xff,
  ];

  it("is stable for the same id", () => {
    expect(tintFromSeed("planet-alpha")).toBe(tintFromSeed("planet-alpha"));
  });

  it("differs across distinct ids", () => {
    expect(tintFromSeed("planet-alpha")).not.toBe(tintFromSeed("planet-beta"));
    expect(tintFromSeed("sys-1-p0")).not.toBe(tintFromSeed("sys-1-p1"));
  });

  it("keeps every channel inside a believable band (191..255)", () => {
    const ids = [
      "a",
      "b",
      "c",
      "planet-alpha",
      "planet-beta",
      "sys-7-p3",
      "ice-world-42",
      "volcanic-99",
      "gas-giant-12",
      "habitat-3",
    ];
    for (const id of ids) {
      for (const ch of channels(tintFromSeed(id))) {
        expect(ch).toBeGreaterThanOrEqual(191);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });

  it("produces a spread of tints across many ids (not all identical)", () => {
    const tints = new Set<number>();
    for (let i = 0; i < 50; i++) tints.add(tintFromSeed(`planet-${i}`));
    // The vast majority must be unique — a believable spread, not one colour.
    expect(tints.size).toBeGreaterThan(45);
  });

  it("respects a custom band floor", () => {
    // A tighter band (higher floor) keeps channels even closer to white.
    for (let i = 0; i < 20; i++) {
      for (const ch of channels(tintFromSeed(`x-${i}`, { floor: 0.9 }))) {
        expect(ch).toBeGreaterThanOrEqual(Math.floor(0.9 * 255));
      }
    }
  });
});
