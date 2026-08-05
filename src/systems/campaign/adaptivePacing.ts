import {
  ADAPTIVE_SPREAD_SLOW_DAYS,
  ADAPTIVE_SPREAD_FAST_DAYS,
  ADAPTIVE_CREEP_START_DAY,
  ADAPTIVE_CREEP_MIN_DAYS,
} from "@/config/balance";

export interface AdaptivePacingConfig {
  slowDays: number;
  fastDays: number;
  creepStartDay: number;
  creepMinDays: number;
}

export const DEFAULT_ADAPTIVE_PACING: AdaptivePacingConfig = {
  slowDays: ADAPTIVE_SPREAD_SLOW_DAYS,
  fastDays: ADAPTIVE_SPREAD_FAST_DAYS,
  creepStartDay: ADAPTIVE_CREEP_START_DAY,
  creepMinDays: ADAPTIVE_CREEP_MIN_DAYS,
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

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
