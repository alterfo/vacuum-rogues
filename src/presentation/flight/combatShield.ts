export interface ShieldCombatConfig {
  shieldFlashMs: number;
  shieldFlashPeakAlpha: number;
  shieldFlashRadiusScale: number;
  barWidth: number;
  barHeight: number;
  barGap: number;
  barYOffset: number;
}

export const DEFAULT_SHIELD_COMBAT: ShieldCombatConfig = {
  shieldFlashMs: 260,
  shieldFlashPeakAlpha: 0.45,
  shieldFlashRadiusScale: 1.35,
  barWidth: 44,
  barHeight: 4,
  barGap: 2,
  barYOffset: 26,
};

export interface ShieldedDamageResult {
  readonly shields: number;
  readonly shieldAbsorbed: number;
  readonly hullDamage: number;
  readonly shieldHit: boolean;
}

export function resolveShieldedDamage(
  shields: number,
  damage: number,
): ShieldedDamageResult {
  const sh = Number.isFinite(shields) ? Math.max(0, shields) : 0;
  const dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  const shieldAbsorbed = Math.min(sh, dmg);
  return {
    shields: sh - shieldAbsorbed,
    shieldAbsorbed,
    hullDamage: dmg - shieldAbsorbed,
    shieldHit: shieldAbsorbed > 0,
  };
}

export function barFraction(current: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const cur = Number.isFinite(current) ? current : 0;
  return Math.max(0, Math.min(1, cur / max));
}

export function shieldFlashAlpha(
  ageMs: number,
  config: ShieldCombatConfig = DEFAULT_SHIELD_COMBAT,
): number {
  const dur = config.shieldFlashMs;
  const peak = Math.max(0, config.shieldFlashPeakAlpha);
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return peak;
  if (ageMs >= dur) return 0;
  return peak * (1 - ageMs / dur);
}
