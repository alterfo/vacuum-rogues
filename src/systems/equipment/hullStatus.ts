/**
 * Hull status math — the single source of truth shared by the planet hull-%
 * display and the Верфь "missing/perfect" repair check, so the two can never
 * disagree (the 2026-06-27 "71% hull but «Корпус уже в идеальном состоянии»"
 * desync).
 *
 * The canonical max hull is the loadout's `derivedStats().maxHull`; the live
 * `PlayerShip.maxHull` is only a projection refreshed on hull swaps / load
 * (`applyLoadoutHullToShip`), so it can lag behind the loadout — e.g. after a
 * defense micromodule raises the derived max without touching the live ship.
 * Always prefer the loadout value when one is available.
 */
export interface HullStatus {
  /** Canonical max hull (loadout-derived when available, else the live ship's). */
  readonly maxHull: number;
  /** Whole-percent hull fill (0..100), clamped to a positive denominator. */
  readonly percent: number;
  /** Hull points missing vs the canonical max (`> 0` ⇒ repairable). */
  readonly missing: number;
  /** True iff the hull is at/above the canonical max (nothing to repair). */
  readonly isPerfect: boolean;
}

/**
 * Project a ship's current hull into a display/repair-consistent status.
 *
 * @param hullHP         current hull points (the live `PlayerShip.hullHP`)
 * @param shipMaxHull    the live `PlayerShip.maxHull` projection (fallback)
 * @param loadoutMaxHull `playerLoadout.derivedStats().maxHull` when a loadout
 *                       exists — the canonical max; preferred over `shipMaxHull`
 */
export function hullStatus(
  hullHP: number,
  shipMaxHull: number,
  loadoutMaxHull?: number,
): HullStatus {
  const maxHull = Math.max(1, loadoutMaxHull ?? shipMaxHull);
  const missing = maxHull - hullHP;
  return {
    maxHull,
    // Clamp to the documented 0..100 range: the live `hullHP` can briefly exceed
    // the canonical max while a buffing hull micromodule is removed before the
    // live ship is re-synced, which would otherwise push the percent past 100
    // and crash a `repeat(10 - pct/10)` bar renderer with a negative count.
    percent: Math.max(0, Math.min(100, Math.round((hullHP / maxHull) * 100))),
    missing,
    isPerfect: missing <= 0,
  };
}
