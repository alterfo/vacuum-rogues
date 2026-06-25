import {
  Text,
  type TextStyleAlign,
  type TextStyleFontStyle,
  type TextStyleFontWeight,
} from "pixi.js";
import { scaledFont } from "@/utils/fontScale";

/**
 * Shared panel-text factory: a single seam every dark-panel scene routes its
 * text through so the S/M/L font-size setting actually reaches the UI *and* the
 * text stays legible.
 *
 * Two guarantees:
 *  1. **Scales with the setting** — `fontSize` is `scaledFont(basePx)`, so panel
 *     text tracks S/M/L like the flight HUD already does (instead of the 20+
 *     hardcoded `fontSize:` literals this replaces).
 *  2. **Readable on dark panels** — a color floor lifts near-background grays /
 *     blue-grays up to a legible luminance while passing bright colors through
 *     untouched. Hue is preserved where possible (the blue-gray accents stay
 *     blue, just bright enough to read).
 */

/**
 * Legible color floor for text on the game's dark panels (gray 180). A fill
 * dimmer than this — measured by relative luminance — is brightened up to it.
 */
export const READABLE_FLOOR = 0xb4b4b4;

/** Linearize one 0–255 sRGB channel (WCAG relative-luminance transfer). */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an 0xRRGGBB color, in [0, 1]. */
export function relativeLuminance(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

const FLOOR_LUMINANCE = relativeLuminance(READABLE_FLOOR);

function pack(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/**
 * Lift a dim fill up to the legible floor, preserving hue where possible.
 * Bright colors (luminance already ≥ floor) are returned unchanged.
 *
 * Phase 1 scales the channels up by a common factor — this keeps both hue and
 * saturation (the blue-gray stays blue) as long as nothing clips. If a channel
 * clips before the floor is reached (very dark or near-black inputs), phase 2
 * mixes the clipped result toward white to make up the remaining luminance.
 */
export function readableFill(color: number): number {
  if (relativeLuminance(color) >= FLOOR_LUMINANCE) return color;

  const r0 = (color >> 16) & 0xff;
  const g0 = (color >> 8) & 0xff;
  const b0 = color & 0xff;

  // Phase 1: hue- and saturation-preserving brighten.
  let r = r0;
  let g = g0;
  let b = b0;
  for (let s = 1.0; s <= 6.0; s += 0.04) {
    r = Math.min(255, Math.round(r0 * s));
    g = Math.min(255, Math.round(g0 * s));
    b = Math.min(255, Math.round(b0 * s));
    if (relativeLuminance(pack(r, g, b)) >= FLOOR_LUMINANCE) {
      return pack(r, g, b);
    }
  }

  // Phase 2: scaling clipped before the floor — mix toward white.
  for (let t = 0.04; t <= 1.0; t += 0.04) {
    const rr = Math.round(r + (255 - r) * t);
    const gg = Math.round(g + (255 - g) * t);
    const bb = Math.round(b + (255 - b) * t);
    if (relativeLuminance(pack(rr, gg, bb)) >= FLOOR_LUMINANCE) {
      return pack(rr, gg, bb);
    }
  }

  return READABLE_FLOOR;
}

/**
 * The device pixel ratio, or `fallback` when `window`/DPR is unavailable
 * (bare Node, Vitest without a DOM). Read through a `typeof` guard so it never
 * throws a `ReferenceError` off the browser.
 */
export function devicePixelRatioOr(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  return window.devicePixelRatio || fallback;
}

export interface ScaledTextOpts {
  fontFamily?: string;
  fontWeight?: TextStyleFontWeight;
  fontStyle?: TextStyleFontStyle;
  align?: TextStyleAlign;
  wordWrap?: boolean;
  wordWrapWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  /**
   * Skip the readability floor and use `color` verbatim — for the rare text
   * drawn on a light background, where the dark-panel floor would wash it out.
   */
  rawColor?: boolean;
}

/**
 * Create a PixiJS `Text` sized by the current font-scale setting and lifted to
 * a legible color on dark panels. The single seam panels should use instead of
 * hardcoding `fontSize:` and dim fills.
 *
 * @param text   the string to render
 * @param basePx the unscaled font size (multiplied by the S/M/L scale)
 * @param color  the desired 0xRRGGBB fill (brightened if too dim, unless `rawColor`)
 */
export function scaledText(
  text: string,
  basePx: number,
  color: number,
  opts: ScaledTextOpts = {},
): Text {
  const fill = opts.rawColor ? color : readableFill(color);
  return new Text({
    text,
    // High-DPI render: the renderer is `autoDensity`, but a `Text` left at the
    // default 1× resolution is rasterised once then upscaled to the device pixel
    // ratio → blurry on Retina/HiDPI. Pinning the resolution to the device pixel
    // ratio rasterises at native density. One change sharpens every migrated
    // panel. Degrades to 1 when `window`/DPR is absent (bare Node / Vitest).
    resolution: devicePixelRatioOr(1),
    style: {
      fontFamily: opts.fontFamily ?? "Courier New",
      fontSize: scaledFont(basePx),
      fill,
      ...(opts.fontWeight !== undefined ? { fontWeight: opts.fontWeight } : {}),
      ...(opts.fontStyle !== undefined ? { fontStyle: opts.fontStyle } : {}),
      ...(opts.align !== undefined ? { align: opts.align } : {}),
      ...(opts.wordWrap !== undefined ? { wordWrap: opts.wordWrap } : {}),
      ...(opts.wordWrapWidth !== undefined
        ? { wordWrapWidth: opts.wordWrapWidth }
        : {}),
      ...(opts.lineHeight !== undefined ? { lineHeight: opts.lineHeight } : {}),
      ...(opts.letterSpacing !== undefined
        ? { letterSpacing: opts.letterSpacing }
        : {}),
    },
  });
}
