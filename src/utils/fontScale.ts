export type FontSizeKey = "S" | "M" | "L";

export const FONT_SCALES: Record<FontSizeKey, number> = {
  S: 0.85,
  M: 1.0,
  L: 1.25,
};

const STORAGE_KEY = "fontScale";
const VALID_KEYS: ReadonlySet<string> = new Set(["S", "M", "L"]);

export function currentFontSizeKey(): FontSizeKey {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VALID_KEYS.has(stored) ? (stored as FontSizeKey) : "M";
}

export function currentFontScale(): number {
  return FONT_SCALES[currentFontSizeKey()];
}

export function setFontScale(size: FontSizeKey): void {
  localStorage.setItem(STORAGE_KEY, size);
}

/** Return `base` multiplied by the current font scale, rounded to integer. */
export function scaledFont(base: number): number {
  return Math.round(base * currentFontScale());
}
