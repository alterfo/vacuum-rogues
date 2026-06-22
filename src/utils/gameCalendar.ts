/**
 * Game calendar: converts the internal `gameDays` counter (days elapsed since
 * the start of the game) into an in-universe date. The game begins on the first
 * day of the year {@link GAME_START_YEAR}. Uses a simple 12 × 30-day calendar
 * (360-day year) — enough for a thematic, readable date without real-calendar
 * edge cases.
 */
export const GAME_START_YEAR = 4000;

const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Calendar components for a given elapsed-day count. */
export interface GameDate {
  readonly year: number;
  /** 1-based month (1–12). */
  readonly month: number;
  /** 1-based day of month (1–30). */
  readonly day: number;
}

/** Convert elapsed game days into year/month/day (game start = day 0). */
export function toGameDate(gameDays: number): GameDate {
  const total = Math.max(0, Math.floor(gameDays));
  const year = GAME_START_YEAR + Math.floor(total / DAYS_PER_YEAR);
  const dayOfYear = total % DAYS_PER_YEAR;
  return {
    year,
    month: Math.floor(dayOfYear / DAYS_PER_MONTH) + 1,
    day: (dayOfYear % DAYS_PER_MONTH) + 1,
  };
}

/** Human-readable in-universe date, e.g. "1 января 4000 г." */
export function formatGameDate(gameDays: number): string {
  const { year, month, day } = toGameDate(gameDays);
  return `${day} ${MONTHS_RU[month - 1]} ${year} г.`;
}

/**
 * Date + sub-day clock, e.g. "6 января 4000 г. 06:00". Unlike {@link formatGameDate}
 * this surfaces the *fractional* part of `gameDays` as a 24-hour time-of-day so a
 * turn whose ship hasn't yet crossed a whole day still shows time visibly moving
 * (the HUD date read-out reuses the scene's fractional `currentDay`). The whole-day
 * portion still drives the calendar date.
 */
export function formatGameTimestamp(gameDays: number): string {
  const safe = Math.max(0, gameDays);
  const frac = safe - Math.floor(safe);
  const totalMinutes = Math.floor(frac * 24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const clock = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return `${formatGameDate(safe)} ${clock}`;
}
