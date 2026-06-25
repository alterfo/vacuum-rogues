/**
 * Task 2 (shared scaled + readable panel-text helper). `scaledText` is the one
 * seam every dark-panel scene routes text through, so it must guarantee:
 *  - font size tracks the S/M/L setting (`scaledFont(basePx)`), and
 *  - a dim fill is lifted to a legible floor while a bright fill passes through.
 *
 * Real PixiJS `Text` constructs in jsdom (no WebGL needed for style inspection),
 * so the assertions read the produced node's `style.fontSize` / `style.fill`.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  scaledText,
  readableFill,
  relativeLuminance,
  devicePixelRatioOr,
  READABLE_FLOOR,
} from "@/presentation/ui/scaledText";
import { setFontScale, scaledFont } from "@/utils/fontScale";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

const FLOOR_LUM = relativeLuminance(READABLE_FLOOR);

// The JobBoardPanel readability offenders (the screenshot in the plan).
const DIM_BLUE_GRAY = 0x889aaa;
const DIMMER_BLUE_GRAY = 0x668899;

describe("scaledText font size tracks S/M/L", () => {
  it("uses scaledFont(basePx) at each scale", () => {
    setFontScale("M");
    expect(scaledText("x", 14, 0xffffff).style.fontSize).toBe(scaledFont(14));
    expect(scaledText("x", 14, 0xffffff).style.fontSize).toBe(14);

    setFontScale("S");
    expect(scaledText("x", 14, 0xffffff).style.fontSize).toBe(scaledFont(14)); // round(14*0.85)=12

    setFontScale("L");
    expect(scaledText("x", 14, 0xffffff).style.fontSize).toBe(scaledFont(14)); // round(14*1.25)=18
  });

  it("scales monotonically S < M < L", () => {
    setFontScale("S");
    const small = scaledText("x", 20, 0xffffff).style.fontSize as number;
    setFontScale("M");
    const med = scaledText("x", 20, 0xffffff).style.fontSize as number;
    setFontScale("L");
    const large = scaledText("x", 20, 0xffffff).style.fontSize as number;
    expect(small).toBeLessThan(med);
    expect(med).toBeLessThan(large);
  });
});

describe("scaledText renders at the device pixel ratio (crisp on HiDPI)", () => {
  const ORIGINAL_DPR = window.devicePixelRatio;
  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", {
      value: ORIGINAL_DPR,
      configurable: true,
    });
  });

  function stubDpr(value: number): void {
    Object.defineProperty(window, "devicePixelRatio", {
      value,
      configurable: true,
    });
  }

  it("pins the Text resolution to window.devicePixelRatio", () => {
    stubDpr(3);
    expect(scaledText("x", 12, 0xffffff).resolution).toBe(3);
    stubDpr(2);
    expect(scaledText("x", 12, 0xffffff).resolution).toBe(2);
  });

  it("falls back to 1 when DPR is 0/undefined", () => {
    stubDpr(0);
    expect(scaledText("x", 12, 0xffffff).resolution).toBe(1);
  });

  it("devicePixelRatioOr reads the live DPR, else the fallback", () => {
    stubDpr(2.5);
    expect(devicePixelRatioOr(1)).toBe(2.5);
    stubDpr(0);
    expect(devicePixelRatioOr(7)).toBe(7);
  });
});

describe("readableFill color floor", () => {
  it("leaves bright colors untouched", () => {
    for (const bright of [0xffffff, 0xffd700, 0x66ccff, 0xb4b4b4]) {
      expect(readableFill(bright)).toBe(bright);
    }
  });

  it("brightens dim blue-grays above the legible floor", () => {
    for (const dim of [DIM_BLUE_GRAY, DIMMER_BLUE_GRAY]) {
      const lifted = readableFill(dim);
      expect(lifted).not.toBe(dim);
      expect(relativeLuminance(lifted)).toBeGreaterThan(relativeLuminance(dim));
      expect(relativeLuminance(lifted)).toBeGreaterThanOrEqual(FLOOR_LUM);
    }
  });

  it("keeps the blue-gray blue (hue preserved, not forced to gray)", () => {
    const lifted = readableFill(DIM_BLUE_GRAY);
    const r = (lifted >> 16) & 0xff;
    const b = lifted & 0xff;
    expect(b).toBeGreaterThan(r); // still blue-dominant
  });

  it("lifts even near-black via the white-mix fallback", () => {
    const lifted = readableFill(0x000000);
    expect(relativeLuminance(lifted)).toBeGreaterThanOrEqual(FLOOR_LUM);
  });
});

describe("scaledText fill", () => {
  it("applies the readability floor by default", () => {
    expect(scaledText("x", 12, DIM_BLUE_GRAY).style.fill).toBe(
      readableFill(DIM_BLUE_GRAY),
    );
  });

  it("passes a bright color through verbatim", () => {
    expect(scaledText("x", 12, 0xffd700).style.fill).toBe(0xffd700);
  });

  it("honors rawColor to skip the floor", () => {
    expect(
      scaledText("x", 12, DIM_BLUE_GRAY, { rawColor: true }).style.fill,
    ).toBe(DIM_BLUE_GRAY);
  });
});

describe("relativeLuminance is WCAG-anchored", () => {
  // Anchor the transfer function to concrete values: the readability floor and
  // every "lifted" color is calibrated on these constants, so a flipped channel
  // coefficient or wrong gamma must fail a test rather than silently shift the
  // floor (the relative > comparisons elsewhere move both sides together).
  it("maps black to 0 and white to 1", () => {
    expect(relativeLuminance(0x000000)).toBe(0);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 5);
  });

  it("weights green > red > blue (locks the channel coefficients)", () => {
    expect(relativeLuminance(0x00ff00)).toBeGreaterThan(
      relativeLuminance(0xff0000),
    );
    expect(relativeLuminance(0xff0000)).toBeGreaterThan(
      relativeLuminance(0x0000ff),
    );
  });

  it("matches the sRGB gamma curve at mid-gray", () => {
    expect(relativeLuminance(0x808080)).toBeCloseTo(0.2158, 3);
  });
});

describe("scaledText forwards style opts", () => {
  it("passes each provided ScaledTextOpts field into the Text style", () => {
    setFontScale("M");
    const t = scaledText("hello world", 12, 0xffffff, {
      fontFamily: "monospace",
      fontWeight: "bold",
      fontStyle: "italic",
      align: "center",
      wordWrap: true,
      wordWrapWidth: 123,
      lineHeight: 22,
      letterSpacing: 3,
    });
    expect(t.style.fontFamily).toBe("monospace");
    expect(t.style.fontWeight).toBe("bold");
    expect(t.style.fontStyle).toBe("italic");
    expect(t.style.align).toBe("center");
    expect(t.style.wordWrap).toBe(true);
    expect(t.style.wordWrapWidth).toBe(123);
    expect(t.style.lineHeight).toBe(22);
    expect(t.style.letterSpacing).toBe(3);
  });

  it("defaults fontFamily to Courier New and leaves wordWrap off when omitted", () => {
    const t = scaledText("x", 12, 0xffffff);
    expect(t.style.fontFamily).toBe("Courier New");
    expect(t.style.wordWrap).toBe(false);
  });
});
