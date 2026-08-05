export interface CombatRoundConfig {
  readonly hullFraction: number;
}

const MIN_ROUND_BUDGET = 1;

export function roundDamageBudget(
  maxHull: number,
  config: CombatRoundConfig,
): number {
  const hull = Math.max(0, maxHull);
  if (hull <= MIN_ROUND_BUDGET) return Math.max(MIN_ROUND_BUDGET, hull);
  const ceiling = hull - MIN_ROUND_BUDGET;
  const raw = hull * clampFraction(config.hullFraction);
  return Math.min(ceiling, Math.max(MIN_ROUND_BUDGET, raw));
}

export function roundAcceptsShot(
  damageTakenThisRound: number,
  maxHull: number,
  config: CombatRoundConfig,
): boolean {
  return damageTakenThisRound < roundDamageBudget(maxHull, config);
}

export function roundIsComplete(
  damageTakenThisRound: number,
  hull: number,
  maxHull: number,
  config: CombatRoundConfig,
): boolean {
  return (
    hull > 0 &&
    damageTakenThisRound >= roundDamageBudget(Math.min(hull, maxHull), config)
  );
}

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0.5;
  const EPS = 1e-6;
  return Math.min(1 - EPS, Math.max(EPS, fraction));
}
