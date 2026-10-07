import { Container, Graphics, type TextStyleFontWeight } from "pixi.js";
import { scaledFont } from "@/utils/fontScale";
import { scaledText } from "./scaledText";
import { MONO_CHAR_WIDTH_RATIO } from "./questCardLayout";

export type ThreatBannerLevel = "warning" | "critical";

export const STAR_MAP_STAT_LINE_PX = 12;

export const THREAT_BANNER_BASE_PX = 15;

export const THREAT_BANNER_WEIGHT: TextStyleFontWeight = "bold";

export const THREAT_BANNER_PADDING = 8;

export const THREAT_BANNER_CORNER = 6;

export interface ThreatBannerColors {
  fill: number;
  border: number;
  text: number;
}

export function threatBannerColors(
  level: ThreatBannerLevel,
): ThreatBannerColors {
  return level === "critical"
    ? { fill: 0x3a0808, border: 0xff2222, text: 0xffdcdc }
    : { fill: 0x33200a, border: 0xff8844, text: 0xffe6cc };
}

export function threatBannerText(level: ThreatBannerLevel): string {
  return level === "critical"
    ? "!! КРИТИЧЕСКАЯ УГРОЗА: РАЗУМ ЗАХВАТЫВАЕТ ГАЛАКТИКУ"
    : "! ВНИМАНИЕ: РАЗУМ РАСШИРЯЕТСЯ";
}

export const THREAT_BANNER_PULSE_MS = 1200;

export const THREAT_BANNER_PULSE_MIN_ALPHA = 0.6;

export function threatBannerPulseAlpha(elapsedMs: number): number {
  const phase =
    (Math.sin((elapsedMs / THREAT_BANNER_PULSE_MS) * Math.PI * 2) + 1) / 2;
  return (
    THREAT_BANNER_PULSE_MIN_ALPHA + (1 - THREAT_BANNER_PULSE_MIN_ALPHA) * phase
  );
}

export function shouldPulseThreatBanner(level: ThreatBannerLevel): boolean {
  return level === "critical";
}

export function threatBannerWidth(text: string): number {
  const charPx = scaledFont(THREAT_BANNER_BASE_PX) * MONO_CHAR_WIDTH_RATIO;
  return Math.ceil(text.length * charPx) + THREAT_BANNER_PADDING * 2;
}

export function threatBannerHeight(): number {
  return scaledFont(THREAT_BANNER_BASE_PX) + THREAT_BANNER_PADDING * 2;
}

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
