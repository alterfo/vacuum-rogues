export interface BankingConfig {
  rollPerTurnRate: number;
  maxRollAngle: number;
  rollSmoothingPerMs: number;
}

export const DEFAULT_BANKING: BankingConfig = {
  rollPerTurnRate: 100,
  maxRollAngle: Math.PI / 6,
  rollSmoothingPerMs: 0.004,
};

function wrapAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function shipTurnRate(
  prevAngle: number,
  currAngle: number,
  dtMs: number,
): number {
  if (!(dtMs > 0)) return 0;
  if (!Number.isFinite(prevAngle) || !Number.isFinite(currAngle)) return 0;
  return wrapAngle(currAngle - prevAngle) / dtMs;
}

export function bankingAngle(
  turnRate: number,
  config: BankingConfig = DEFAULT_BANKING,
): number {
  if (!Number.isFinite(turnRate) || turnRate === 0) return 0;
  const max = Math.abs(config.maxRollAngle);
  const raw = turnRate * config.rollPerTurnRate;
  return Math.max(-max, Math.min(max, raw));
}

export function approachRoll(
  current: number,
  target: number,
  dtMs: number,
  config: BankingConfig = DEFAULT_BANKING,
): number {
  if (!(dtMs > 0)) return current;
  const maxStep = Math.max(0, config.rollSmoothingPerMs) * dtMs;
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}
