/**
 * Shield-vs-hull damage ordering + status-bar/flash geometry. Pure, PixiJS-free.
 *
 * Task 12 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). The ship shield pool
 * (`PlayerShip.shields`/`maxShields`, `NpcShip.shields`) has always been a **persisted domain
 * stat that no combat damage code ever read**. This module is its first real consumer: incoming
 * damage is absorbed by shields up to the current shield value, and only the **overflow** reaches
 * the hull (which still routes through `applyDamageWithMode` for the GOD-mode floor — this module
 * never touches the hull-flooring rule, it only splits the incoming damage into a shield-absorbed
 * part and a hull-overflow part).
 *
 * It also owns the pure fraction mapping the floating hull/shield bars render from, and the shield
 * flash fade curve, so both the bar renderer (`combatStatusBars.ts`) and the flash renderer
 * (`combatShieldFlash.ts`) stay thin drawing seams over pure numbers.
 *
 * **Coordination with Task 9:** `combatConsumable.applyShieldRestore` defines the shield-restore
 * (clamp-to-max, never-reduce) semantics; this module follows them — a shield is a `[0, maxShields]`
 * pool that damage drains and a shield-cell refills. The two never disagree about what a shield
 * value means.
 *
 * Kept a pure module (no PixiJS / no scene / no domain deps) unit-tested standalone — the same
 * discipline as `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile` /
 * `combatAfterburner` / `combatConsumable` / `combatBanking`. Live tuning comes from `SHIELD_COMBAT`
 * in `balance.ts`; the scene passes it in so tune-in-one-place holds.
 */

/** Tuning for shield damage-ordering VFX + the floating bars; mirrors `SHIELD_COMBAT` in `balance.ts`. */
export interface ShieldCombatConfig {
  /** How long the translucent shield-absorb sphere fades over (ms). */
  shieldFlashMs: number;
  /** The sphere's opacity at the instant of the hit (fades to 0). */
  shieldFlashPeakAlpha: number;
  /** Sphere radius as a multiple of the struck ship's radius. */
  shieldFlashRadiusScale: number;
  /** The floating hull/shield bar width (world px). */
  barWidth: number;
  /** The floating hull/shield bar height (world px). */
  barHeight: number;
  /** Vertical gap between the stacked hull and shield bars (world px). */
  barGap: number;
  /** How far above the ship centre the bar stack floats (world px). */
  barYOffset: number;
}

/** Module-local default, mirroring `SHIELD_COMBAT` so this file stays import-light for tests. */
export const DEFAULT_SHIELD_COMBAT: ShieldCombatConfig = {
  shieldFlashMs: 260,
  shieldFlashPeakAlpha: 0.45,
  shieldFlashRadiusScale: 1.35,
  barWidth: 44,
  barHeight: 4,
  barGap: 2,
  barYOffset: 26,
};

/** The split of an incoming hit into its shield-absorbed and hull-overflow parts. */
export interface ShieldedDamageResult {
  /** Shield value **after** absorption (never below 0, never above the pre-hit value). */
  readonly shields: number;
  /** Damage the shields soaked up this hit (0 when shields were already down). */
  readonly shieldAbsorbed: number;
  /** Overflow damage that reaches the hull — feed this to `applyDamageWithMode`. */
  readonly hullDamage: number;
  /** True when the shields absorbed any of the hit — the trigger for the shield-flash VFX. */
  readonly shieldHit: boolean;
}

/**
 * Split an incoming `damage` hit against a ship's current `shields`. Shields absorb up to their
 * current value; the remainder overflows to the hull. Returns the new shield value, the absorbed
 * amount, the hull-bound overflow, and whether the shield was hit (drives the flash).
 *
 * Non-finite / negative inputs are treated as 0 (a NaN shield or damage never leaks a bad value
 * into the damage math). This is a pure split only — the hull-flooring / GOD-mode rule stays in
 * `applyDamageWithMode`, which the caller runs on `hullDamage`.
 */
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

/**
 * Map a `current`/`max` pair to a `[0, 1]` bar fill fraction, the value both the hull and shield
 * floating bars render their width from. A non-positive / non-finite `max` (a shield-less ship) is
 * an empty bar (0); `current` above `max` clamps to a full bar (1). Negative `current` clamps to 0.
 */
export function barFraction(current: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const cur = Number.isFinite(current) ? current : 0;
  return Math.max(0, Math.min(1, cur / max));
}

/**
 * The translucent shield-flash sphere's opacity at `ageMs` into its life, fading **linearly** from
 * `shieldFlashPeakAlpha` at the hit instant to 0 at `shieldFlashMs`. A non-positive age reads as
 * the peak; an age at/after the duration (or a non-positive duration) reads as 0 (faded out).
 */
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
