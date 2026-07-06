/**
 * Adaptive Overmind spread pacing (three-year-campaign Task 3) — the 2–3-year
 * campaign clock. The EOD arc drive (`DayTickController.advanceOvermindArc`)
 * asks this module how many days sit between spread ticks; the answer is a
 * pure function of (day, arc day-zero, RATCHETED player power):
 *
 *   interval = lerp(SLOW, FAST, clamp01(peakPower))          — power pressure
 *   interval = min(interval, CREEP_MIN)  once past CREEP_START — baseline creep
 *
 * The power input must be the ratcheted `campaignPeakPower` (never decreases
 * within a run — see `ratchetPeakPower`), so the schedule itself is
 * non-increasing over a run: growing strong summons the war, selling gear
 * never buys breathing room back. The creep floor guarantees a permanently
 * idle run still reaches the loss share well before the 1080-day ceiling.
 *
 * Pure and deterministic; all tunables live in `src/config/balance.ts`
 * (ADAPTIVE_*), never at call sites.
 */
import {
  ADAPTIVE_SPREAD_SLOW_DAYS,
  ADAPTIVE_SPREAD_FAST_DAYS,
  ADAPTIVE_CREEP_START_DAY,
  ADAPTIVE_CREEP_MIN_DAYS,
} from "@/config/balance";

/** The pacing levers (mirrors the ADAPTIVE_* balance constants). */
export interface AdaptivePacingConfig {
  /** Spread interval (days) faced by a powerless player (index 0). */
  slowDays: number;
  /** Spread interval (days) faced by a maxed player (index 1). */
  fastDays: number;
  /** Days past the arc's day-zero after which the creep floor kicks in. */
  creepStartDay: number;
  /** Creep floor: the interval is capped at this once creep is active. */
  creepMinDays: number;
}

/** The live tuning (balance.ts) as a config object — the default for callers. */
export const DEFAULT_ADAPTIVE_PACING: AdaptivePacingConfig = {
  slowDays: ADAPTIVE_SPREAD_SLOW_DAYS,
  fastDays: ADAPTIVE_SPREAD_FAST_DAYS,
  creepStartDay: ADAPTIVE_CREEP_START_DAY,
  creepMinDays: ADAPTIVE_CREEP_MIN_DAYS,
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Days between Overmind spread ticks for the given day and ratcheted power.
 *
 * `dayZero` is the arc's clock start (`OvermindSpreadState.dayZero`); before
 * the clock has started (-1) the creep anchor is the current day, so creep is
 * never active on an unstarted arc. Always ≥ 1 whole day.
 */
export function adaptiveSpreadIntervalDays(
  day: number,
  dayZero: number,
  peakPower: number,
  cfg: AdaptivePacingConfig = DEFAULT_ADAPTIVE_PACING,
): number {
  const t = clamp01(peakPower);
  const lerped = cfg.slowDays + (cfg.fastDays - cfg.slowDays) * t;
  const anchor = dayZero >= 0 ? dayZero : day;
  const creepActive = day >= anchor + cfg.creepStartDay;
  const interval = creepActive ? Math.min(lerped, cfg.creepMinDays) : lerped;
  return Math.max(1, Math.round(interval));
}
