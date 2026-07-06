/**
 * `playerPowerIndex` — the adaptive-difficulty input (three-year-campaign
 * Task 2). Collapses the player's material strength into one number in [0,1];
 * the Overmind's spread cadence and garrison scaling (Tasks 3–4) consume the
 * RATCHETED value so difficulty never decreases when the player sheds power.
 *
 * Everything here is pure and deterministic; all tunables live in
 * `src/config/balance.ts` (POWER_INDEX_*), never at call sites. Hull/weapon
 * numbers must come from the canonical GearCatalog loadout (`derivedStats`) —
 * use {@link powerIndexFromLoadout}; never recompute hull stats elsewhere.
 */
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

/** The four power components the index is derived from. */
export interface PowerInputs {
  /** Loadout-derived maximum hull HP (`derivedStats().maxHull`). */
  readonly maxHull: number;
  /** Loadout-derived total installed weapon damage. */
  readonly weaponDamage: number;
  /** Spendable credits (the current-account projection). */
  readonly credits: number;
  /** Rank index on the 0–7 ladder (`Player.rank`). */
  readonly rank: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear normalization of x onto [0,1] between min and max, clamped. */
function norm(x: number, min: number, max: number): number {
  return clamp01((x - min) / (max - min));
}

/**
 * The player-power index ∈ [0,1]: 0 ≈ starter fitting, 1 ≈ apex loadout with
 * a full war chest. Weighted sum of per-component linear norms — monotone
 * non-decreasing in every component.
 */
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

/**
 * Power index read from the canonical GearCatalog loadout (single source of
 * truth for hull/weapon stats) plus the player's credits and rank.
 */
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

/**
 * The ratchet: the persisted `campaignPeakPower` only ever rises within a run.
 * No stored peak yet (fresh run / pre-campaign save) ⇒ seed from the current
 * index. Out-of-range inputs (corrupted save) clamp into [0,1].
 */
export function ratchetPeakPower(
  prev: number | null | undefined,
  current: number,
): number {
  const cur = clamp01(current);
  return prev == null ? cur : Math.max(clamp01(prev), cur);
}

/**
 * Load semantics for the optional additive `campaignPeakPower` save field:
 * present ⇒ trust it (clamped); absent (save predates the campaign) ⇒ derive
 * from the just-restored loadout so old saves get a faithful starting peak
 * without a migration or version bump.
 */
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
