import { describe, it, expect } from "vitest";
import {
  starAppearanceJitter,
  shiftTemperature,
  CORONA_SPREAD,
  GLOW_SPREAD,
} from "@/utils/starAppearance";

/**
 * Task 2 (per-instance planet/star variety): every sun must look distinct, not
 * uniform within a StarType. `starAppearanceJitter` gives a deterministic,
 * bounded per-`systemId` jitter (corona scale, glow intensity, colour
 * temperature) around the StarType base; `shiftTemperature` applies the temp
 * shift to a base tint without leaving the believable band.
 */
describe("starAppearanceJitter (per-system sun variation)", () => {
  it("is stable for the same systemId", () => {
    expect(starAppearanceJitter("sys-7")).toEqual(
      starAppearanceJitter("sys-7"),
    );
  });

  it("differs across distinct systemIds", () => {
    const a = starAppearanceJitter("sys-1");
    const b = starAppearanceJitter("sys-2");
    // At least one appearance param must differ.
    expect(
      a.coronaScale !== b.coronaScale ||
        a.glowIntensity !== b.glowIntensity ||
        a.tempShift !== b.tempShift,
    ).toBe(true);
  });

  it("keeps corona/glow scale + intensity inside a believable band", () => {
    for (let i = 0; i < 60; i++) {
      const j = starAppearanceJitter(`sys-${i}`);
      expect(j.coronaScale).toBeGreaterThanOrEqual(1 - CORONA_SPREAD);
      expect(j.coronaScale).toBeLessThanOrEqual(1 + CORONA_SPREAD);
      expect(j.glowIntensity).toBeGreaterThanOrEqual(1 - GLOW_SPREAD);
      expect(j.glowIntensity).toBeLessThanOrEqual(1 + GLOW_SPREAD);
      expect(j.tempShift).toBeGreaterThanOrEqual(-1);
      expect(j.tempShift).toBeLessThanOrEqual(1);
    }
  });

  it("produces a spread of jitters across many systems", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const j = starAppearanceJitter(`system-${i}`);
      seen.add(`${j.coronaScale}|${j.glowIntensity}|${j.tempShift}`);
    }
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe("shiftTemperature (bounded colour-temperature nudge)", () => {
  const ch = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

  it("returns the base unchanged at zero shift", () => {
    expect(shiftTemperature(0xffd9a0, 0)).toBe(0xffd9a0);
  });

  it("warms (R up / B down) for a positive shift, cools for negative", () => {
    const base = 0xaaaaaa;
    const warm = ch(shiftTemperature(base, 1));
    const cool = ch(shiftTemperature(base, -1));
    expect(warm[0]).toBeGreaterThan(0xaa); // R up when warmer
    expect(warm[2]).toBeLessThan(0xaa); // B down
    expect(cool[0]).toBeLessThan(0xaa); // R down when cooler
    expect(cool[2]).toBeGreaterThan(0xaa); // B up
  });

  it("never leaves the 0..255 byte range and stays near the base", () => {
    for (const base of [0xff7a4d, 0x8fb8ff, 0xfff2e6, 0xffd9a0, 0xcfe0ff]) {
      for (const shift of [-1, -0.5, 0.5, 1]) {
        const out = ch(shiftTemperature(base, shift));
        const inBase = ch(base);
        out.forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
          // Bounded shift: stays within the configured amount of the base.
          expect(Math.abs(v - inBase[i])).toBeLessThanOrEqual(30);
        });
      }
    }
  });

  it("gives distinct colours for distinct temp shifts", () => {
    expect(shiftTemperature(0xffd9a0, 0.8)).not.toBe(
      shiftTemperature(0xffd9a0, -0.8),
    );
  });
});
