import { estimateWrappedLines, lineStepFor } from "./questCardLayout";

export interface RowContent {
  title: string;
  hasIssuer: boolean;
  description: string;
  hasHighlights: boolean;
}

export interface RowMetrics {
  wrapWidth: number;
  tagFontPx: number;
  metaFontPx: number;
  titleFontPx: number;
  issuerFontPx: number;
  descFontPx: number;
  highlightsFontPx: number;
  minHeight: number;
}

export interface RowLayout {
  contentHeight: number;
  titleY: number;
  issuerY: number;
  descY: number;
  highlightsY: number;
}

export const TOP_PAD = 6;
const GAP = 6;
const BOTTOM_PAD = 14;

export function computeRowLayout(
  content: RowContent,
  metrics: RowMetrics,
): RowLayout {
  const topLineStep = Math.max(
    lineStepFor(metrics.tagFontPx),
    lineStepFor(metrics.metaFontPx),
  );
  const titleY = TOP_PAD + topLineStep;
  const titleLines = estimateWrappedLines(
    content.title,
    metrics.wrapWidth,
    metrics.titleFontPx,
  );
  let cursor = titleY + titleLines * lineStepFor(metrics.titleFontPx);

  const issuerY = cursor;
  if (content.hasIssuer) {
    cursor += lineStepFor(metrics.issuerFontPx);
  }
  if (content.description) cursor += GAP;

  const descY = cursor;
  if (content.description) {
    const descLines = estimateWrappedLines(
      content.description,
      metrics.wrapWidth,
      metrics.descFontPx,
    );
    cursor += descLines * lineStepFor(metrics.descFontPx);
  }
  if (content.hasHighlights) cursor += GAP;

  const highlightsY = cursor;
  if (content.hasHighlights) {
    cursor += lineStepFor(metrics.highlightsFontPx);
  }

  const contentHeight = Math.max(metrics.minHeight, cursor + BOTTOM_PAD);
  return { contentHeight, titleY, issuerY, descY, highlightsY };
}
