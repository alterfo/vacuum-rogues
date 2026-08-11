import { scaledFont } from "@/utils/fontScale";

export const MONO_CHAR_WIDTH_RATIO = 0.62;

export function clampLabelToWidth(
  text: string,
  basePx: number,
  budgetPx: number,
): string {
  const charPx = Math.max(1, scaledFont(basePx) * MONO_CHAR_WIDTH_RATIO);
  const maxChars = Math.max(3, Math.floor(budgetPx / charPx));
  return text.length > maxChars
    ? text.slice(0, Math.max(1, maxChars - 1)) + "…"
    : text;
}

export function estimateTextWidthPx(text: string, basePx: number): number {
  return text.length * Math.max(1, scaledFont(basePx) * MONO_CHAR_WIDTH_RATIO);
}

export function estimateWrappedLines(
  text: string,
  wrapWidth: number,
  fontSizePx: number,
  charWidthRatio = MONO_CHAR_WIDTH_RATIO,
): number {
  if (!text) return 1;
  const charPx = Math.max(1, fontSizePx * charWidthRatio);
  const charsPerLine = Math.max(1, Math.floor(wrapWidth / charPx));
  const effective = Math.max(1, Math.floor(charsPerLine * 0.85));
  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / effective));
  }
  return Math.max(1, lines);
}

export interface QuestCardContent {
  title: string;
  objectives: string[];
  rewardLine: string;
  hasHighlights: boolean;
}

export interface QuestCardMetrics {
  fontSizePx: number;
  titleWrapWidth: number;
  bodyWrapWidth: number;
}

export interface QuestCardLayout {
  contentHeight: number;
  titleY: number;
  objectiveYs: number[];
  rewardY: number;
  highlightsY: number;
}

const TOP_PAD = 10;
const TITLE_GAP = 7;
const REWARD_GAP = 2;
const BOTTOM_PAD = 14;
export const MIN_CARD_HEIGHT = 130;

export function lineStepFor(fontSizePx: number): number {
  return Math.max(1, Math.round(fontSizePx * 1.4));
}

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
