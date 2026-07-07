/**
 * Round-based combat scheduler (pure, PixiJS-free) — campaign Task 9 (v).
 *
 * In-flight combat resolves in real time ({@link CombatModule}). Left unbounded,
 * a single headless resolution step (or a live player who resumed the fight)
 * could take enough stacked volleys to drop from **full hull to zero before ever
 * getting a turn** — the death mode that four bounded config/harness escalations
 * could not close (see `docs/plans/20260706-three-year-campaign.md`, Task 9).
 *
 * This scheduler chunks the fire exchange into **rounds** with a disengage check
 * between them: a round may remove at most a fixed fraction of the ship's MAX
 * hull ({@link CombatRoundConfig.hullFraction}); once that budget is spent the
 * caller halts fire and raises a reaction window (an active-pause re-raise for
 * the live player, a decision turn for the headless agent). Because the fraction
 * is `< 1`, a ship can **never** go from full hull to zero inside one round — the
 * defender always gets a flee/fight decision first. A committed fight (choosing
 * to fight on, round after round) still loses across multiple rounds, so fleeing
 * has a cost: it is an escape window, not invulnerability.
 *
 * Kept as a pure standalone module (the same discipline as `combatPause`) so the
 * round arithmetic unit-tests without a rendering context; the CombatModule wires
 * the live damage accumulation + reaction-window side effects.
 */

/** Tunable shape of a combat round. */
export interface CombatRoundConfig {
  /**
   * Max fraction of MAX hull a single round may remove. Clamped to `(0, 1)` on
   * read so a malformed `0`/`≥1` can neither freeze the fight (budget 0) nor
   * allow a full-hull one-shot (budget ≥ maxHull).
   */
  readonly hullFraction: number;
}

/** The smallest positive hull a round may ever be allowed to remove. */
const MIN_ROUND_BUDGET = 1;

/**
 * The per-round incoming-damage budget in hull points: at most this many hull
 * points may be removed before the round completes. Always `≥ 1` (a round can
 * always take at least one shot, so a committed fight never dead-locks) and
 * strictly `< maxHull` (so full → zero is impossible in one round), by clamping
 * the configured fraction into `[MIN_ROUND_BUDGET/maxHull, <1)`.
 */
export function roundDamageBudget(
  maxHull: number,
  config: CombatRoundConfig,
): number {
  const hull = Math.max(0, maxHull);
  if (hull <= MIN_ROUND_BUDGET) return Math.max(MIN_ROUND_BUDGET, hull);
  // Keep the budget strictly below full hull: even a maxed fraction leaves a
  // sliver of hull, guaranteeing the "never full → zero in one round" invariant.
  const ceiling = hull - MIN_ROUND_BUDGET;
  const raw = hull * clampFraction(config.hullFraction);
  return Math.min(ceiling, Math.max(MIN_ROUND_BUDGET, raw));
}

/**
 * Whether the round can still accept another incoming shot — i.e. its budget is
 * not yet spent. The first shot of a round is always accepted (`taken` starts at
 * 0 `< budget`), so a committed fight always makes progress; the shot that
 * crosses the budget still lands in full (no mid-shot clamp), then the round
 * completes and the next call returns `false`.
 */
export function roundAcceptsShot(
  damageTakenThisRound: number,
  maxHull: number,
  config: CombatRoundConfig,
): boolean {
  return damageTakenThisRound < roundDamageBudget(maxHull, config);
}

/**
 * Whether the round is complete — its budget spent — while the defender is still
 * alive (a dead defender ends the fight, not a reaction window). The reaction
 * window opens on this transition.
 */
export function roundIsComplete(
  damageTakenThisRound: number,
  hull: number,
  maxHull: number,
  config: CombatRoundConfig,
): boolean {
  return hull > 0 && damageTakenThisRound >= roundDamageBudget(maxHull, config);
}

/** Clamp a configured fraction into the open interval `(0, 1)`. */
function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0.5;
  const EPS = 1e-6;
  return Math.min(1 - EPS, Math.max(EPS, fraction));
}
