import type { GameMode } from "@/types";
import type { Player } from "@/domain/Player";
import { GOD_MODE_HULL_FLOOR_FRACTION } from "@/config/balance";

/**
 * Pure difficulty-mode combat helpers (`docs/plans/20260620-game-difficulty-modes-god-normal-hard.md`).
 *
 * GOD mode keeps the ship alive: a lethal hit floors the hull at a small positive
 * fraction of maxHull instead of reaching 0, and the ship goes "downed" (can't
 * fire weapons or hyperjump until repaired above the floor). NORMAL/HARD are
 * unchanged — damage clamps to 0 and the ship can die.
 *
 * "Downed" is *derived*, never persisted: it is re-computed from the player's
 * gameMode + current hull, so repairing above the floor clears it automatically.
 * No PixiJS/DOM deps — unit-tested standalone.
 */

/** Result of {@link applyDamageWithMode}: the new hull HP and the derived downed flag. */
export interface ModeDamageResult {
  /** Hull HP after damage (floored above 0 in GOD; clamped to 0 in NORMAL/HARD). */
  readonly hull: number;
  /** True only in GOD mode once the hull has been floored (hull ≤ the GOD floor). */
  readonly downed: boolean;
}

/**
 * Hull HP below which a ship can never drop in the given mode.
 * - GOD: `ceil(maxHull × GOD_MODE_HULL_FLOOR_FRACTION)`, always ≥ 1 (positive).
 * - NORMAL/HARD: 0 — no floor, the hull can reach 0 and the ship can die.
 */
export function hullFloorFor(mode: GameMode, maxHull: number): number {
  if (mode !== "GOD") return 0;
  return Math.max(1, Math.ceil(maxHull * GOD_MODE_HULL_FLOOR_FRACTION));
}

/**
 * Applies `damage` to `hull` under the given difficulty mode.
 * - GOD: hull is floored at {@link hullFloorFor} (always > 0); a lethal hit
 *   leaves the ship alive but `downed`.
 * - NORMAL/HARD: hull clamps to 0 (drop-in for the old `Math.max(0, hull - dmg)`),
 *   `downed` is always false.
 *
 * Damage and maxHull are read-only; the function returns the new state.
 */
export function applyDamageWithMode(
  mode: GameMode,
  hull: number,
  damage: number,
  maxHull: number,
): ModeDamageResult {
  const floor = hullFloorFor(mode, maxHull);
  const newHull = Math.max(floor, hull - damage);
  return { hull: newHull, downed: isHullDowned(mode, newHull, maxHull) };
}

/**
 * Player-free "downed" predicate over a raw hull reading: true only in GOD mode
 * when `hull` is at or below the GOD floor for `maxHull`. The shared core behind
 * both {@link isDowned} (scene/jump gates) and the combat damage path, so the
 * "GOD && hull ≤ floor" rule lives in exactly one place. NORMAL/HARD are never
 * downed.
 */
export function isHullDowned(
  mode: GameMode,
  hull: number,
  maxHull: number,
): boolean {
  return mode === "GOD" && hull <= hullFloorFor(mode, maxHull);
}

/**
 * Derived "downed" predicate: true only in GOD mode when the ship's hull is at
 * or below the GOD floor. Not persisted — re-derived from gameMode + current
 * hull, so repairing above the floor clears it. NORMAL/HARD are never downed.
 */
export function isDowned(player: Player): boolean {
  return isHullDowned(player.gameMode, player.ship.hullHP, player.ship.maxHull);
}
