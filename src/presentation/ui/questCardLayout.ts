/**
 * Pure, PixiJS/DOM-free layout math for a quest-journal card.
 *
 * A quest card used to be a fixed 130 px box whose title/objective text carried
 * no `wordWrapWidth`, so a long title, a long objective description, or many
 * objectives spilled past the card's right edge and bled into the next card
 * (playtest bug "текст в заданиях наплывает если его много").
 *
 * The fix is two-fold and both halves live here so they stay in lockstep:
 *  1. Text is word-wrapped at a known inner width (the caller passes the wrap
 *     widths to `scaledText`), and
 *  2. the card height TRACKS the wrapped content instead of being a fixed 130 px,
 *     computed from the title's + each objective's wrapped line count.
 *
 * Wrapping is estimated, not measured: PixiJS text metrics are unavailable in a
 * unit test (and unreliable under jsdom), so {@link estimateWrappedLines} returns
 * a deliberate UPPER BOUND on the real line count for a monospace font — a card
 * sized from it is never too SHORT for the real PixiJS-wrapped text (it may be a
 * touch tall, which only adds harmless empty space). The real-render regression
 * (E2E screenshot) confirms the bound holds for the actual renderer.
 */

/**
 * Monospace (Courier New) glyph advance as a fraction of the font size. The
 * panel font is "Courier New" (see `scaledText`), so every glyph advances ~0.6em.
 * We use a slightly larger ratio so the estimated chars-per-line is conservative.
 */
export const MONO_CHAR_WIDTH_RATIO = 0.62;

/**
 * Safe UPPER-BOUND estimate of how many lines `text` wraps to within `wrapWidth`
 * px at `fontSizePx`, for a monospace font with greedy word-wrap. Greedy wrapping
 * wastes space at line ends (it breaks on word boundaries, not mid-word), so the
 * real line count is `>= ceil(len / charsPerLine)`; we shrink the effective line
 * capacity by a fudge factor to stay an upper bound. Hard newlines split first.
 */
export function estimateWrappedLines(
  text: string,
  wrapWidth: number,
  fontSizePx: number,
  charWidthRatio = MONO_CHAR_WIDTH_RATIO,
): number {
  if (!text) return 1;
  const charPx = Math.max(1, fontSizePx * charWidthRatio);
  const charsPerLine = Math.max(1, Math.floor(wrapWidth / charPx));
  // 0.85: leave headroom for greedy word-wrap's end-of-line waste so the line
  // count is an over-estimate rather than an under-estimate.
  const effective = Math.max(1, Math.floor(charsPerLine * 0.85));
  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / effective));
  }
  return Math.max(1, lines);
}

/** The text content of a quest card, pre-formatted by the caller. */
export interface QuestCardContent {
  /** The (already-built) quest title string. */
  title: string;
  /** Each objective's full display line (icon + description + counts + suffix). */
  objectives: string[];
  /** The "Награда: …" summary line. */
  rewardLine: string;
  /** Whether a highlights row ([Система: …] etc.) is rendered. */
  hasHighlights: boolean;
}

/** Geometry inputs for the card layout (caller-derived, pure). */
export interface QuestCardMetrics {
  /** Scaled font size in px (e.g. `scaledFont(13)`). */
  fontSizePx: number;
  /** Wrap width for the title (leaves room for the right-aligned type label). */
  titleWrapWidth: number;
  /** Wrap width for objective + reward body text (leaves room for side buttons). */
  bodyWrapWidth: number;
}

/** Resolved per-row vertical positions + the total content height. */
export interface QuestCardLayout {
  /** Total content height of the card in px (drives the bg rect + the step). */
  contentHeight: number;
  /** y of the title's first line. */
  titleY: number;
  /** y of each objective's first line (parallel to `content.objectives`). */
  objectiveYs: number[];
  /** y of the reward line. */
  rewardY: number;
  /** y of the highlights row (valid only when `content.hasHighlights`). */
  highlightsY: number;
}

const TOP_PAD = 10;
const TITLE_GAP = 7;
const REWARD_GAP = 2;
const BOTTOM_PAD = 14;
/** Minimum card box height — keeps short cards looking like the historical 130 px box. */
export const MIN_CARD_HEIGHT = 130;

/** Per-line vertical step for `fontSizePx` (≈ the historical 18 px at base 13). */
export function lineStepFor(fontSizePx: number): number {
  return Math.max(1, Math.round(fontSizePx * 1.4));
}

/**
 * Lay a quest card out top-down from its wrapped content. Pure: identical inputs
 * give identical positions, so the renderer and the height/step math (used by the
 * `ScrollableList` viewport) can never desync. `contentHeight` is the bare content
 * height; the caller clamps it to {@link MIN_CARD_HEIGHT} for the drawn box.
 */
export function layoutQuestCard(
  content: QuestCardContent,
  metrics: QuestCardMetrics,
): QuestCardLayout {
  const line = lineStepFor(metrics.fontSizePx);

  const titleLines = estimateWrappedLines(
    content.title,
    metrics.titleWrapWidth,
    metrics.fontSizePx,
  );
  const titleY = TOP_PAD;

  let cursor = TOP_PAD + titleLines * line + TITLE_GAP;
  const objectiveYs: number[] = [];
  for (const obj of content.objectives) {
    objectiveYs.push(cursor);
    const objLines = estimateWrappedLines(
      obj,
      metrics.bodyWrapWidth,
      metrics.fontSizePx,
    );
    cursor += objLines * line;
  }

  const rewardY = cursor + REWARD_GAP;
  const rewardLines = estimateWrappedLines(
    content.rewardLine,
    metrics.bodyWrapWidth,
    metrics.fontSizePx,
  );
  const highlightsY = rewardY + rewardLines * line;

  const contentBottom = content.hasHighlights
    ? highlightsY + line
    : rewardY + rewardLines * line;
  const contentHeight = contentBottom + BOTTOM_PAD;

  return { contentHeight, titleY, objectiveYs, rewardY, highlightsY };
}
