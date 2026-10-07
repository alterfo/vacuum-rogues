import { scaledFont } from "@/utils/fontScale";
import { lineStepFor, MONO_CHAR_WIDTH_RATIO } from "./questCardLayout";

export const BOARD_TITLE_BASE_PX = 18;
export const BOARD_NOTE_BASE_PX = 11;
export const SCROLL_HINT_BASE_PX = 10;
export const SCROLL_ARROW_BASE_PX = 16;

const TITLE_Y = 14;
const NOTE_GAP = 2;
const HEAD_PAD_BELOW_NOTE = 6;
const COMPACT_HEAD_H = 48;
const ARROW_HINT_GAP = 6;

export interface BoardHead {
  titleY: number;
  noteY: number;
  height: number;
}

export function boardHead(showCapNote: boolean): BoardHead {
  const noteY =
    TITLE_Y + lineStepFor(scaledFont(BOARD_TITLE_BASE_PX)) + NOTE_GAP;
  const noteBottom = noteY + lineStepFor(scaledFont(BOARD_NOTE_BASE_PX));
  return {
    titleY: TITLE_Y,
    noteY,
    height: showCapNote
      ? Math.max(COMPACT_HEAD_H, noteBottom + HEAD_PAD_BELOW_NOTE)
      : COMPACT_HEAD_H,
  };
}

export function scrollArrowOffset(hint: string): number {
  const hintHalf =
    (hint.length * scaledFont(SCROLL_HINT_BASE_PX) * MONO_CHAR_WIDTH_RATIO) / 2;
  const arrowHalf = scaledFont(SCROLL_ARROW_BASE_PX) / 2;
  return Math.ceil(hintHalf + arrowHalf + ARROW_HINT_GAP);
}

export const HIGHLIGHT_TAG_BASE_PX = 11;
const HIGHLIGHT_TAG_GAP = 8;

export function highlightTagXs(
  texts: readonly string[],
  startX: number,
  limitX: number,
): number[] {
  const charPx = scaledFont(HIGHLIGHT_TAG_BASE_PX) * MONO_CHAR_WIDTH_RATIO;
  const xs: number[] = [];
  let x = startX;
  for (const text of texts) {
    const width = Math.ceil(text.length * charPx);
    if (x + width > limitX) break;
    xs.push(x);
    x += width + HIGHLIGHT_TAG_GAP;
  }
  return xs;
}
