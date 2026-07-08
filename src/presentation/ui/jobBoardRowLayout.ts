/**
 * Pure, PixiJS-free row-height math for `JobBoardPanel`'s offer/active rows
 * (Task 2, `docs/plans/20260708-font-scale-and-faction-bugs.md`). A row used
 * to be a fixed-pixel box (`ROW_H`/`ROW_H_OFFER`) whose title was truncated by
 * character count (not word-wrap) and whose description ignored its own
 * wrapped-line count when sizing the box — so a long title/description at "L"
 * font scale overflowed past the row's drawn background into the next row.
 *
 * The row height now TRACKS the wrapped content, reusing the same
 * `estimateWrappedLines`/`lineStepFor` upper-bound estimate `questCardLayout.ts`
 * already uses for `QuestJournalUI`'s dynamic card height.
 */
import { estimateWrappedLines, lineStepFor } from "./questCardLayout";

/** The text content of a job-board row, pre-formatted by the caller. */
export interface RowContent {
  title: string;
  hasIssuer: boolean;
  description: string;
  hasHighlights: boolean;
}

/** Geometry inputs for the row layout (caller-derived, pure). */
export interface RowMetrics {
  /** Shared wrap width for the title + description — leaves clearance before
   * the right-aligned reward/countdown badge on the row's first line. */
  wrapWidth: number;
  tagFontPx: number;
  titleFontPx: number;
  issuerFontPx: number;
  descFontPx: number;
  highlightsFontPx: number;
  /** Historical fixed row height — the floor so a short row doesn't shrink. */
  minHeight: number;
}

/** Resolved row geometry: total box height + each block's y offset from the row's top. */
export interface RowLayout {
  contentHeight: number;
  titleY: number;
  issuerY: number;
  descY: number;
  highlightsY: number;
}

const TOP_PAD = 6;
const GAP = 6;
const BOTTOM_PAD = 14;

/**
 * Lay a job-board row out top-down from its wrapped content. Pure: identical
 * inputs give identical positions, so the renderer and the scroll/mask
 * geometry (which needs each row's real height to place the next row) can
 * never desync.
 */
export function computeRowLayout(
  content: RowContent,
  metrics: RowMetrics,
): RowLayout {
  const titleY = TOP_PAD + lineStepFor(metrics.tagFontPx);
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
  cursor += GAP;

  const descY = cursor;
  if (content.description) {
    const descLines = estimateWrappedLines(
      content.description,
      metrics.wrapWidth,
      metrics.descFontPx,
    );
    cursor += descLines * lineStepFor(metrics.descFontPx);
  }
  cursor += GAP;

  const highlightsY = cursor;
  if (content.hasHighlights) {
    cursor += lineStepFor(metrics.highlightsFontPx);
  }

  const contentHeight = Math.max(metrics.minHeight, cursor + BOTTOM_PAD);
  return { contentHeight, titleY, issuerY, descY, highlightsY };
}
