import {
  GAME_BALANCE,
  HOSTILE_SCALING_WEAK_MULT,
  NEUTRAL_SCALING_WEAK_MULT,
  NEUTRAL_SCALING_STRONG_MULT,
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
  DIFFICULTY_HOSTILE_SCALING,
} from "@/config/balance";
import type { GameMode } from "@/types";

export interface HostileScaling {
  hpMult: number;
  damageMult: number;
}

export interface HostileScalingConfig {
  weakMult: number;
  hpMultStrong: number;
  damageMultStrong: number;
}

export const DEFAULT_HOSTILE_SCALING_CONFIG: HostileScalingConfig = {
  weakMult: HOSTILE_SCALING_WEAK_MULT,
  hpMultStrong: GAME_BALANCE.OVERMIND_COMBAT_HP_MULT,
  damageMultStrong: GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
};

export const NEUTRAL_HOSTILE_SCALING: HostileScaling = {
  hpMult: 1,
  damageMult: 1,
};

export interface NeutralScalingConfig {
  weakMult: number;
  strongMult: number;
}

export const DEFAULT_NEUTRAL_SCALING_CONFIG: NeutralScalingConfig = {
  weakMult: NEUTRAL_SCALING_WEAK_MULT,
  strongMult: NEUTRAL_SCALING_STRONG_MULT,
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function hostileScaling(
  powerIndex: number,
  mode: GameMode,
  cfg: HostileScalingConfig = DEFAULT_HOSTILE_SCALING_CONFIG,
): HostileScaling {
  const t = clamp01(powerIndex);
  const modeMult =
    DIFFICULTY_HOSTILE_SCALING[mode]?.hostileCombatMultiplier ?? 1.0;
  return {
    hpMult: (cfg.weakMult + (cfg.hpMultStrong - cfg.weakMult) * t) * modeMult,
    damageMult:
      (cfg.weakMult + (cfg.damageMultStrong - cfg.weakMult) * t) * modeMult,
  };
}

export function neutralScaling(
  powerIndex: number,
  mode: GameMode,
  cfg: NeutralScalingConfig = DEFAULT_NEUTRAL_SCALING_CONFIG,
): HostileScaling {
  const t = clamp01(powerIndex);
  const modeMult =
    DIFFICULTY_HOSTILE_SCALING[mode]?.hostileCombatMultiplier ?? 1.0;
  return {
    hpMult: 1,
    damageMult: (cfg.weakMult + (cfg.strongMult - cfg.weakMult) * t) * modeMult,
  };
}

export function combatScaling(
  powerIndex: number,
  mode: GameMode,
  isHostileSystem: boolean,
): HostileScaling {
  return isHostileSystem
    ? hostileScaling(powerIndex, mode)
    : neutralScaling(powerIndex, mode);
}

export function scaleHostileDamage(damage: number, mult: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round(damage * mult));
}

export function overmindGarrisonPowerBonus(
  powerIndex: number,
  maxBonus: number = OVERMIND_GARRISON_POWER_MAX_BONUS,
): number {
  return Math.floor(clamp01(powerIndex) * maxBonus);
}

export function overmindGarrisonPowerDiscount(
  powerIndex: number,
  maxDiscount: number = OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
): number {
  return Math.floor((1 - clamp01(powerIndex)) * maxDiscount);
}
