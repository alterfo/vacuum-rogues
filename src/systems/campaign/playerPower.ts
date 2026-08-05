import {
  POWER_INDEX_WEIGHTS,
  POWER_INDEX_HULL_MIN,
  POWER_INDEX_HULL_MAX,
  POWER_INDEX_WEAPON_MIN,
  POWER_INDEX_WEAPON_MAX,
  POWER_INDEX_CREDITS_MIN,
  POWER_INDEX_CREDITS_MAX,
  POWER_INDEX_RANK_MAX,
} from "@/config/balance";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";

export interface PowerInputs {
  readonly maxHull: number;
  readonly weaponDamage: number;
  readonly credits: number;
  readonly rank: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function norm(x: number, min: number, max: number): number {
  return clamp01((x - min) / (max - min));
}

export function playerPowerIndex(p: PowerInputs): number {
  const w = POWER_INDEX_WEIGHTS;
  return clamp01(
    w.hull * norm(p.maxHull, POWER_INDEX_HULL_MIN, POWER_INDEX_HULL_MAX) +
      w.weapon *
        norm(p.weaponDamage, POWER_INDEX_WEAPON_MIN, POWER_INDEX_WEAPON_MAX) +
      w.credits *
        norm(p.credits, POWER_INDEX_CREDITS_MIN, POWER_INDEX_CREDITS_MAX) +
      w.rank * norm(p.rank, 0, POWER_INDEX_RANK_MAX),
  );
}

export function powerIndexFromLoadout(
  loadout: ShipLoadout,
  credits: number,
  rank: number,
): number {
  const ds = loadout.derivedStats();
  return playerPowerIndex({
    maxHull: ds.maxHull,
    weaponDamage: ds.weaponDamage,
    credits,
    rank,
  });
}

export function ratchetPeakPower(
  prev: number | null | undefined,
  current: number,
): number {
  const cur = clamp01(current);
  return prev == null ? cur : Math.max(clamp01(prev), cur);
}

export function restoredPeakPower(
  saved: number | null | undefined,
  loadout: ShipLoadout,
  credits: number,
  rank: number,
): number {
  return saved == null
    ? powerIndexFromLoadout(loadout, credits, rank)
    : clamp01(saved);
}
