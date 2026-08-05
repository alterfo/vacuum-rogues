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

export interface GameDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

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

export function formatGameDate(gameDays: number): string {
  const { year, month, day } = toGameDate(gameDays);
  return `${day} ${MONTHS_RU[month - 1]} ${year} г.`;
}

export function formatGameTimestamp(gameDays: number): string {
  const safe = Math.max(0, gameDays);
  const frac = safe - Math.floor(safe);
  const totalMinutes = Math.floor(frac * 24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const clock = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return `${formatGameDate(safe)} ${clock}`;
}
