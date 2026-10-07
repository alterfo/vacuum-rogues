import { describe, it, expect } from "vitest";
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

describe("star-map threat banner weight (Task 6, finding #5)", () => {
  it("renders larger and bolder than the routine stat lines", () => {
    expect(THREAT_BANNER_BASE_PX).toBeGreaterThan(STAR_MAP_STAT_LINE_PX);
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

describe("star-map threat banner pulse", () => {
  it("pulses the critical banner", () => {
    expect(shouldPulseThreatBanner("critical")).toBe(true);
  });

  it("never pulses the lower-severity warning banner", () => {
    expect(shouldPulseThreatBanner("warning")).toBe(false);
  });

  it("oscillates the alpha between the dim floor and full", () => {
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
