/**
 * Task 6 (UX-review fixes, `docs/plans/20260729-ux-review-fixes.md`, finding
 * #5): the star-map galaxy-threat warning used to render as a stray line of red
 * text at the same 12px weight as the routine РАЗУМ/ПИРАТЫ stat lines above it.
 * It now builds a bordered, bold, larger banner chip
 * (`ui/starMapThreatBanner.ts`), with a subtle pulse gated on the reduced-motion
 * accessibility seam.
 *
 * These are pure-helper tests (no renderer): the banner font size/weight differ
 * from the routine stat lines, and the pulse is skipped when reduced motion is
 * set.
 */
import { describe, it, expect } from "vitest";
import type { ReducedMotionEnv } from "@/presentation/ui/reducedMotion";
import {
  STAR_MAP_STAT_LINE_PX,
  THREAT_BANNER_BASE_PX,
  THREAT_BANNER_WEIGHT,
  THREAT_BANNER_PULSE_MIN_ALPHA,
  threatBannerColors,
  threatBannerText,
  threatBannerPulseAlpha,
  shouldPulseThreatBanner,
} from "@/presentation/ui/starMapThreatBanner";

const REDUCED = (on: boolean): ReducedMotionEnv => ({
  store: { getItem: () => (on ? "true" : "false"), setItem: () => {} },
  matchMedia: () => ({ matches: false }),
});

describe("star-map threat banner weight (Task 6, finding #5)", () => {
  it("renders larger and bolder than the routine stat lines", () => {
    // The banner base font is strictly larger than the РАЗУМ/ПИРАТЫ stat lines.
    expect(THREAT_BANNER_BASE_PX).toBeGreaterThan(STAR_MAP_STAT_LINE_PX);
    // ...and it is bold, where the stat lines use the default weight.
    expect(THREAT_BANNER_WEIGHT).toBe("bold");
  });

  it("uses a hotter accent for critical than for warning", () => {
    const critical = threatBannerColors("critical");
    const warning = threatBannerColors("warning");
    expect(critical.border).not.toBe(warning.border);
    expect(critical.fill).not.toBe(warning.fill);
  });

  it("keeps the escalation-specific Russian copy", () => {
    expect(threatBannerText("critical")).toContain("КРИТИЧЕСКАЯ УГРОЗА");
    expect(threatBannerText("warning")).toContain("ВНИМАНИЕ");
  });
});

describe("star-map threat banner pulse (Task 6, reduced-motion seam)", () => {
  it("pulses the critical banner when reduced motion is OFF", () => {
    expect(shouldPulseThreatBanner("critical", REDUCED(false))).toBe(true);
  });

  it("skips the pulse when reduced motion is SET", () => {
    expect(shouldPulseThreatBanner("critical", REDUCED(true))).toBe(false);
  });

  it("never pulses the lower-severity warning banner", () => {
    expect(shouldPulseThreatBanner("warning", REDUCED(false))).toBe(false);
  });

  it("oscillates the alpha between the dim floor and full", () => {
    // Sampled across a full period, the alpha stays within [floor, 1] and
    // actually reaches both extremes (a real pulse, not a constant).
    const samples = Array.from({ length: 24 }, (_, i) =>
      threatBannerPulseAlpha((i / 24) * 1200),
    );
    for (const a of samples) {
      expect(a).toBeGreaterThanOrEqual(THREAT_BANNER_PULSE_MIN_ALPHA - 1e-6);
      expect(a).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.95);
    expect(Math.min(...samples)).toBeLessThan(
      THREAT_BANNER_PULSE_MIN_ALPHA + 0.1,
    );
  });
});
