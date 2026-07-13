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
  NEUTRAL_SCALING_WEAK_MULT,
  NEUTRAL_SCALING_STRONG_MULT,
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
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

/** The no-op scaling for legacy DI sites that never wire the campaign deps (identity). */
export const NEUTRAL_HOSTILE_SCALING: HostileScaling = {
  hpMult: 1,
  damageMult: 1,
};

/** The neutral-system gentling endpoints (Task 9 (i)). */
export interface NeutralScalingConfig {
  /** Incoming-damage multiplier faced by a powerless player (index 0). */
  weakMult: number;
  /** Incoming-damage multiplier faced by a maxed player (index 1) — baseline. */
  strongMult: number;
}

/** The live neutral tuning (balance.ts) as a config object. */
export const DEFAULT_NEUTRAL_SCALING_CONFIG: NeutralScalingConfig = {
  weakMult: NEUTRAL_SCALING_WEAK_MULT,
  strongMult: NEUTRAL_SCALING_STRONG_MULT,
};

/** Clamps into [0,1]; non-finite input (NaN/Infinity) falls back to 0 (safest/weakest). */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
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
 * Neutral-system combat gentling (Task 9 (i)). A weak ship takes reduced
 * INCOMING hits *everywhere* — the wandering faction/pirate packs in neutral
 * systems, not only held-system garrisons — ramping to full baseline as the
 * ratcheted power grows. This is the Overview's "gentle while weak, relentless
 * once armed" applied consistently (Task 4 wired it only to held systems, which
 * left ≈half the campaign one-shot deaths — neutral wandering packs — at full
 * base damage against a starter hull).
 *
 * Offense is UNSCALED here (`hpMult` 1): this gentles survival, not the kill —
 * so a fully armed ship (index 1) faces byte-identical neutral combat on
 * NORMAL/GOD (`strongMult` 1.0). Monotone non-decreasing in power; HARD composes
 * its config multiplier on the incoming damage, never at the call site.
 */
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

/**
 * The combat scaling for the fight the player is actually in: the held-system
 * garrison scaling (weak ⇒ ~0.9×, maxed ⇒ full 1.5× levers) inside an
 * Overmind/pirate-held system, else the neutral gentling (weak ⇒ reduced hits,
 * maxed ⇒ baseline). The single dispatch point the CombatModule consumes.
 */
export function combatScaling(
  powerIndex: number,
  mode: GameMode,
  isHostileSystem: boolean,
): HostileScaling {
  return isHostileSystem
    ? hostileScaling(powerIndex, mode)
    : neutralScaling(powerIndex, mode);
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

/**
 * Mirror of {@link overmindGarrisonPowerBonus}: garrison ships SUBTRACTED
 * from both [min, max] spawn bounds at the given ratcheted power. Monotone
 * non-increasing — `maxDiscount` at power 0 (a powerless player faces a
 * smaller garrison), phasing out to 0 by power 1 (a maxed player faces
 * today's undiscounted range, only the upward bonus applies).
 */
export function overmindGarrisonPowerDiscount(
  powerIndex: number,
  maxDiscount: number = OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
): number {
  return Math.floor((1 - clamp01(powerIndex)) * maxDiscount);
}
