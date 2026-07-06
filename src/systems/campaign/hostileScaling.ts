/**
 * Adaptive garrison & combat scaling (three-year-campaign Task 4) — the
 * production consumer that revives the OVERMIND_COMBAT_HP_MULT /
 * OVERMIND_COMBAT_DAMAGE_MULT levers (dead since the hex CombatScene removal).
 *
 * In-flight fights inside Overmind/pirate-held systems ask this module how
 * hard the hostiles hit and soak; the answer is a pure function of the
 * RATCHETED player power (`campaignPeakPower` — never decreases within a run,
 * see `ratchetPeakPower`) and the difficulty mode:
 *
 *   mult = lerp(WEAK_MULT, OVERMIND_COMBAT_*_MULT, clamp01(peakPower))
 *        × DIFFICULTY_HOSTILE_SCALING[mode].hostileCombatMultiplier
 *
 * Weak player ⇒ gentle ~0.9× garrisons; maxed player ⇒ the full 1.5× levers;
 * HARD composes its config multiplier on top — never at call sites. The same
 * ratchet grows the Overmind standing-garrison COUNT
 * (`overmindGarrisonPowerBonus`, consumed by `NpcSimulator.fillGarrison`) —
 * applied at spawn time each tick, so it is generation-independent and
 * existing saves pick it up as garrisons top up.
 *
 * Pure and deterministic; all tunables live in `src/config/balance.ts`.
 */
import {
  GAME_BALANCE,
  HOSTILE_SCALING_WEAK_MULT,
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  DIFFICULTY_HOSTILE_SCALING,
} from "@/config/balance";
import type { GameMode } from "@/types";

/** Effective HP + outgoing-damage multipliers for hostile-system enemies. */
export interface HostileScaling {
  /** The enemy's effective-HP multiplier (player damage divides by it). */
  hpMult: number;
  /** The enemy's outgoing-damage multiplier (incoming hits scale by it). */
  damageMult: number;
}

/** The scaling endpoints (mirrors the balance levers). */
export interface HostileScalingConfig {
  /** HP/damage multiplier faced by a powerless player (index 0). */
  weakMult: number;
  /** Effective-HP multiplier faced by a maxed player (index 1). */
  hpMultStrong: number;
  /** Damage multiplier faced by a maxed player (index 1). */
  damageMultStrong: number;
}

/** The live tuning (balance.ts) as a config object — the default for callers. */
export const DEFAULT_HOSTILE_SCALING_CONFIG: HostileScalingConfig = {
  weakMult: HOSTILE_SCALING_WEAK_MULT,
  hpMultStrong: GAME_BALANCE.OVERMIND_COMBAT_HP_MULT,
  damageMultStrong: GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
};

/** The no-op scaling for neutral systems / legacy DI sites (identity). */
export const NEUTRAL_HOSTILE_SCALING: HostileScaling = {
  hpMult: 1,
  damageMult: 1,
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * HP/damage multipliers for hostile-system enemies at the given ratcheted
 * power and difficulty mode. Monotone non-decreasing in power; NORMAL and GOD
 * are the identical baseline (their config multiplier is 1.0), HARD composes
 * `hostileCombatMultiplier` from the config table.
 */
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

/**
 * Apply a scaling multiplier to a per-shot damage value: whole-number hits,
 * and a positive source never scales below 1 (a landed hit always hurts).
 * A zero/negative source stays 0 — scaling never conjures damage.
 */
export function scaleHostileDamage(damage: number, mult: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round(damage * mult));
}

/**
 * Extra Overmind standing-garrison ships (added to both the [min, max] spawn
 * bounds) at the given ratcheted power. Floor, not round — the count steps up
 * late ("gentle early, hard late"): 0 extra ships until power 1/maxBonus is
 * crossed, the full bonus only at saturation.
 */
export function overmindGarrisonPowerBonus(
  powerIndex: number,
  maxBonus: number = OVERMIND_GARRISON_POWER_MAX_BONUS,
): number {
  return Math.floor(clamp01(powerIndex) * maxBonus);
}
