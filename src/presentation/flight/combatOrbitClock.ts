export const MS_PER_ORBITAL_DAY = 1000;

export interface CombatOrbitClockInput {
  readonly inCombat: boolean;
  readonly paused: boolean;
  readonly dt: number;
  readonly timeScale: number;
}

export function combatOrbitalDayIncrement(
  input: CombatOrbitClockInput,
): number {
  const { inCombat, paused, dt, timeScale } = input;
  if (!inCombat || paused) return 0;
  const clampedDt = Math.min(Math.max(dt, 0), MS_PER_ORBITAL_DAY);
  return (clampedDt * (timeScale ?? 1)) / MS_PER_ORBITAL_DAY;
}

export function orbitBump(
  paused: boolean,
  dt: number,
  timeScale: number,
): number {
  return combatOrbitalDayIncrement({ inCombat: true, paused, dt, timeScale });
}
