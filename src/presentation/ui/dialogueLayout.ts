export const RESPONSE_BUTTON_BASE_OFFSET = 220;
export const RESPONSE_BUTTON_GAP = 16;

export function firstResponseButtonY(
  panelY: number,
  textY: number,
  textHeight: number,
): number {
  const base = panelY + RESPONSE_BUTTON_BASE_OFFSET;
  if (!Number.isFinite(textHeight) || textHeight <= 0) return base;
  return Math.max(base, textY + textHeight + RESPONSE_BUTTON_GAP);
}
