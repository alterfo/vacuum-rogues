import {
  Text,
  type TextStyleAlign,
  type TextStyleFontStyle,
  type TextStyleFontWeight,
} from "pixi.js";
import { scaledFont } from "@/utils/fontScale";

export const READABLE_FLOOR = 0xb4b4b4;

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

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

export function readableFill(color: number): number {
  if (relativeLuminance(color) >= FLOOR_LUMINANCE) return color;

  const r0 = (color >> 16) & 0xff;
  const g0 = (color >> 8) & 0xff;
  const b0 = color & 0xff;

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
  breakWords?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
  rawColor?: boolean;
}

export function scaledText(
  text: string,
  basePx: number,
  color: number,
  opts: ScaledTextOpts = {},
): Text {
  const fill = opts.rawColor ? color : readableFill(color);
  return new Text({
    text,
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
      ...(opts.breakWords !== undefined ? { breakWords: opts.breakWords } : {}),
      ...(opts.lineHeight !== undefined ? { lineHeight: opts.lineHeight } : {}),
      ...(opts.letterSpacing !== undefined
        ? { letterSpacing: opts.letterSpacing }
        : {}),
    },
  });
}
