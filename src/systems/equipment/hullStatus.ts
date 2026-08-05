export interface HullStatus {
  readonly maxHull: number;
  readonly percent: number;
  readonly missing: number;
  readonly isPerfect: boolean;
}

export function hullStatus(
  hullHP: number,
  shipMaxHull: number,
  loadoutMaxHull?: number,
): HullStatus {
  const maxHull = Math.max(1, loadoutMaxHull ?? shipMaxHull);
  const missing = maxHull - hullHP;
  return {
    maxHull,
    percent: Math.max(0, Math.min(100, Math.round((hullHP / maxHull) * 100))),
    missing,
    isPerfect: missing <= 0,
  };
}

export function repairCost(status: HullStatus, ratePerHp = 2): number | null {
  if (status.isPerfect) return null;
  return Math.ceil(status.missing * ratePerHp);
}
