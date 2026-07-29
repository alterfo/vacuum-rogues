// Star-map critical-threat banner (UX-review fixes,
// `docs/plans/20260729-ux-review-fixes.md`, Task 6, finding #5).
//
// The galaxy-threat warning line used to render as a stray line of red text at
// the same weight/size as the routine РАЗУМ/ПИРАТЫ stat lines above it, so a
// "critical" warning carried no more visual weight than a background stat. This
// module builds it as a bordered, filled chip that reads as a banner: bigger,
// bold, on a dark accent-tinted background.
//
// Pure/testable split:
//  - The colours, text, font metrics and pulse math are pure exports a unit test
//    asserts without a renderer.
//  - `buildThreatBanner` mounts a `Container` (chip `Graphics` + `scaledText`
//    label) sized from the label length via `MONO_CHAR_WIDTH_RATIO` so it needs
//    no PixiJS text measurement (which throws in the jsdom unit harness).
//  - Any pulse animation is gated on `shouldPulseThreatBanner`, which is
//    `false` under the reduced-motion accessibility seam (`reducedMotion`).

import { Container, Graphics, type TextStyleFontWeight } from "pixi.js";
import { scaledFont } from "@/utils/fontScale";
import { scaledText } from "./scaledText";
import { MONO_CHAR_WIDTH_RATIO } from "./questCardLayout";
import { reducedMotion, type ReducedMotionEnv } from "./reducedMotion";

/** The two escalation levels the star-map banner renders (below these it hides). */
export type ThreatBannerLevel = "warning" | "critical";

/**
 * Base (unscaled) font size of the routine РАЗУМ/ПИРАТЫ stat lines — the baseline
 * the banner must out-weigh. Kept here so the test can assert the banner is
 * strictly larger without importing the scene's private render body.
 */
export const STAR_MAP_STAT_LINE_PX = 12;

/** Base (unscaled) font size of the threat banner label — larger than the stats. */
export const THREAT_BANNER_BASE_PX = 15;

/** The banner label is bold; the routine stat lines are the default weight. */
export const THREAT_BANNER_WEIGHT: TextStyleFontWeight = "bold";

/** Inner padding between the chip edge and its label, in unscaled px. */
export const THREAT_BANNER_PADDING = 8;

/** The chip's rounded-corner radius, in px. */
export const THREAT_BANNER_CORNER = 6;

export interface ThreatBannerColors {
  /** Dark accent-tinted chip fill. */
  fill: number;
  /** Bright border matching the escalation hue. */
  border: number;
  /** Legible label colour on the dark fill. */
  text: number;
}

/** Chip/border/text colours for a threat level — critical runs hotter (red). */
export function threatBannerColors(
  level: ThreatBannerLevel,
): ThreatBannerColors {
  return level === "critical"
    ? { fill: 0x3a0808, border: 0xff2222, text: 0xffdcdc }
    : { fill: 0x33200a, border: 0xff8844, text: 0xffe6cc };
}

/** The banner's Russian label for a threat level. */
export function threatBannerText(level: ThreatBannerLevel): string {
  return level === "critical"
    ? "!! КРИТИЧЕСКАЯ УГРОЗА: РАЗУМ ЗАХВАТЫВАЕТ ГАЛАКТИКУ"
    : "! ВНИМАНИЕ: РАЗУМ РАСШИРЯЕТСЯ";
}

// ---------------------------------------------------------------------------
// Pulse — gated on the reduced-motion accessibility seam
// ---------------------------------------------------------------------------

/** Full pulse period in ms (one bright→dim→bright cycle). */
export const THREAT_BANNER_PULSE_MS = 1200;

/** The dimmest alpha the pulse dips to (stays clearly legible). */
export const THREAT_BANNER_PULSE_MIN_ALPHA = 0.6;

/**
 * The banner container's alpha at a given elapsed time, oscillating between
 * {@link THREAT_BANNER_PULSE_MIN_ALPHA} and 1 over {@link THREAT_BANNER_PULSE_MS}.
 * Pure — the scene feeds it accumulated frame time only when pulsing is allowed.
 */
export function threatBannerPulseAlpha(elapsedMs: number): number {
  const phase =
    (Math.sin((elapsedMs / THREAT_BANNER_PULSE_MS) * Math.PI * 2) + 1) / 2;
  return (
    THREAT_BANNER_PULSE_MIN_ALPHA + (1 - THREAT_BANNER_PULSE_MIN_ALPHA) * phase
  );
}

/**
 * Whether the banner should pulse: only the most-urgent `critical` level, and
 * only when reduced motion is **not** requested (the accessibility seam —
 * `reducedMotion` is the OR of the explicit setting and the OS preference). A
 * player with reduced motion set gets a static banner.
 */
export function shouldPulseThreatBanner(
  level: ThreatBannerLevel,
  env?: ReducedMotionEnv,
): boolean {
  return level === "critical" && !reducedMotion(env);
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

/**
 * Estimated chip width for a label, derived from its character count and the
 * mono-font width ratio (no PixiJS measurement — safe in the unit harness).
 */
export function threatBannerWidth(text: string): number {
  const charPx = scaledFont(THREAT_BANNER_BASE_PX) * MONO_CHAR_WIDTH_RATIO;
  return Math.ceil(text.length * charPx) + THREAT_BANNER_PADDING * 2;
}

/** Chip height derived from the scaled label size plus vertical padding. */
export function threatBannerHeight(): number {
  return scaledFont(THREAT_BANNER_BASE_PX) + THREAT_BANNER_PADDING * 2;
}

/**
 * Build the threat banner as a positioned `Container`: a filled + bordered chip
 * behind a bold, larger-than-stat-lines `scaledText` label. Non-interactive
 * (`eventMode="none"`) so it never intercepts map clicks. The caller owns any
 * pulse animation (see {@link shouldPulseThreatBanner} / {@link threatBannerPulseAlpha}).
 */
export function buildThreatBanner(
  level: ThreatBannerLevel,
  x: number,
  y: number,
): Container {
  const colors = threatBannerColors(level);
  const label = threatBannerText(level);
  const w = threatBannerWidth(label);
  const h = threatBannerHeight();

  const container = new Container();
  container.x = x;
  container.y = y;
  container.eventMode = "none";

  const chip = new Graphics();
  chip
    .roundRect(0, 0, w, h, THREAT_BANNER_CORNER)
    .fill({ color: colors.fill, alpha: 0.92 })
    .stroke({ color: colors.border, width: 2 });
  chip.eventMode = "none";
  container.addChild(chip);

  const text = scaledText(label, THREAT_BANNER_BASE_PX, colors.text, {
    fontWeight: THREAT_BANNER_WEIGHT,
    rawColor: true,
  });
  text.x = THREAT_BANNER_PADDING;
  text.y = THREAT_BANNER_PADDING;
  text.eventMode = "none";
  container.addChild(text);

  return container;
}
