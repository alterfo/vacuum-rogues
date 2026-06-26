import { hashStr } from "@/utils/hashStr";

/**
 * Exploration-encounter generator (pure).
 *
 * Rolls a *random in-system encounter* — a derelict to salvage, a spatial
 * anomaly to scan, or a distress call to answer — when the player enters /
 * flies through a system. It is the spice between trade/quest loops and feeds
 * the living-galaxy feel.
 *
 * Pure: no GameEngine/PixiJS/DOM coupling, no `Math.random`. Occurrence is
 * **deterministic by `(systemId, seed)`** (folded through `hashStr`) so the same
 * entry always rolls the same encounter — unit-testable, replay-stable. The
 * caller (the flight scene / NPC manager) supplies the per-entry `seed` and
 * routes the resulting `Encounter` into a choice prompt + the outcome resolver
 * (Task 2). The current caller rolls **once per system entry**, so the per-entry
 * occurrence probability (`baseChance`..`maxChance`) is its flood-control; the
 * `playerState.stepsSinceLastEncounter` / `config.minGap` pair is the optional
 * extra gap guard for a caller that rolls on a finer cadence (per flight tick).
 *
 * The companion resolver (`encounterOutcome.ts`) reads the `danger` / `rewardScale`
 * this generator stamps on the encounter to weight trap/ambush odds and payoffs.
 */

/** The three exploration-encounter flavours. */
export type EncounterType = "derelict" | "anomaly" | "distress";

/**
 * Minimal system view the generator reads (the real `StarSystem` plus a galaxy
 * danger lookup satisfies this structurally). `danger` is a `0..1` scalar —
 * `0` = safe core space, `1` = an Overmind/pirate-held system — derived by the
 * caller (e.g. from `galaxy.isOvermindSystem`/`isPirateSystem` or the star-map
 * threat level). It lifts both the encounter *rate* and the encounter *danger*.
 */
export interface EncounterSystemView {
  id: string;
  /** 0 (safe) .. 1 (hostile-held) — scales encounter chance, danger and reward. */
  danger: number;
}

/**
 * Minimal player view: how far the player has progressed and how the underworld
 * sees them. `level` lifts reward magnitude (tougher encounters worth more);
 * `pirateRep` (negative ⇒ pirate-friendly) and `stepsSinceLastEncounter` shape
 * occurrence + danger. All optional so a bare caller degrades to neutral.
 */
export interface EncounterPlayerState {
  /** Player progression scalar (≥1); lifts reward magnitude. Defaults to 1. */
  level?: number;
  /** Pirate-faction reputation; a hostile rep nudges the danger up. Defaults to 0. */
  pirateRep?: number;
  /**
   * Steps (flight ticks / day rolls) since the last encounter fired — the
   * optional finer-cadence gap guard. Below `config.minGap` no encounter rolls.
   * The entry-based caller leaves this **undefined** (it rolls once per system
   * entry and relies on the occurrence probability for "spice, not a flood");
   * undefined is treated as "long ago" so such a roll is always eligible.
   */
  stepsSinceLastEncounter?: number;
}

/** A rolled encounter the caller presents + resolves. */
export interface Encounter {
  /** Deterministic id `enc:<systemId>:<seed>` — stable for a given entry. */
  id: string;
  type: EncounterType;
  systemId: string;
  /**
   * 0..1 danger of *this* encounter — feeds the resolver's trap/ambush odds and
   * the reward/penalty magnitude. Scaled up by system danger + a hostile rep.
   */
  danger: number;
  /**
   * Reward magnitude multiplier (≥1) the resolver multiplies its base payoffs
   * by — higher in dangerous space and for a more progressed player (risk↔reward).
   */
  rewardScale: number;
}

export interface EncounterConfig {
  /** Probability an eligible roll yields an encounter at zero system danger. */
  baseChance: number;
  /**
   * Optional finer-cadence gap: encounters can't fire within this many steps of
   * the last one, but only for a caller that tracks `stepsSinceLastEncounter`.
   * The entry-based caller leaves that undefined, so this gate is inert there
   * (per-entry occurrence probability is its flood-control instead).
   */
  minGap: number;
  /** Extra chance per unit system danger (`chance += danger × dangerChanceBoost`). */
  dangerChanceBoost: number;
  /** Hard ceiling on the per-roll chance after danger scaling. */
  maxChance: number;
  /** Type weights at zero danger (relative; need not sum to 1). */
  weights: Record<EncounterType, number>;
  /**
   * Extra `distress` weight per unit system danger — dangerous space is more
   * likely to bait the player with an ambush-prone distress call.
   */
  distressDangerWeight: number;
  /** Reward-scale lift per unit system danger. */
  rewardDangerMult: number;
  /** Reward-scale lift per player level above 1. */
  rewardLevelMult: number;
}

/**
 * Default tuning. Kept here so the pure generator has a sensible standalone
 * default for tests/callers; the balance pass (Task 4) mirrors it into
 * `balance.ts` as the single source of truth for live wiring.
 */
export const DEFAULT_ENCOUNTER_CONFIG: EncounterConfig = {
  baseChance: 0.15,
  minGap: 4,
  dangerChanceBoost: 0.25,
  maxChance: 0.6,
  weights: { derelict: 5, anomaly: 4, distress: 3 },
  distressDangerWeight: 6,
  rewardDangerMult: 1.5,
  rewardLevelMult: 0.1,
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Deterministic `0..1` from an arbitrary key (FNV-1a → unit interval). */
function hashUnit(key: string): number {
  return (hashStr(key) % 100000) / 100000;
}

/**
 * Weighted, deterministic type pick. `roll` is a `0..1` value; weights are the
 * danger-scaled relative weights. Falls back to `derelict` if all weights are 0.
 */
function pickType(
  roll: number,
  weights: Record<EncounterType, number>,
): EncounterType {
  const order: EncounterType[] = ["derelict", "anomaly", "distress"];
  const total = order.reduce((s, t) => s + Math.max(0, weights[t]), 0);
  if (total <= 0) return "derelict";
  let acc = 0;
  const target = roll * total;
  for (const t of order) {
    acc += Math.max(0, weights[t]);
    if (target < acc) return t;
  }
  return order[order.length - 1];
}

/**
 * Roll an exploration encounter for a system entry / flight tick.
 *
 * Returns `null` when (a) the rate limit blocks it (too soon since the last
 * encounter) or (b) the deterministic occurrence roll misses. Otherwise returns
 * a weighted, danger/level-scaled `Encounter`. Deterministic by `(system.id, seed)`.
 */
export function rollEncounter(
  system: EncounterSystemView,
  seed: string | number,
  playerState: EncounterPlayerState = {},
  config: EncounterConfig = DEFAULT_ENCOUNTER_CONFIG,
): Encounter | null {
  const sysDanger = clamp01(system.danger);
  const seedKey = String(seed);

  // Rate limit — undefined means "no recent encounter", so it's eligible.
  const since = playerState.stepsSinceLastEncounter ?? Number.POSITIVE_INFINITY;
  if (since < config.minGap) return null;

  // Occurrence roll — deterministic by (system, seed).
  const chance = Math.min(
    config.maxChance,
    config.baseChance + sysDanger * config.dangerChanceBoost,
  );
  const occur = hashUnit(`${system.id}:${seedKey}:occur`);
  if (occur >= chance) return null;

  // Type — danger lifts the distress (ambush-bait) weight.
  const weights: Record<EncounterType, number> = {
    derelict: config.weights.derelict,
    anomaly: config.weights.anomaly,
    distress: config.weights.distress + sysDanger * config.distressDangerWeight,
  };
  const typeRoll = hashUnit(`${system.id}:${seedKey}:type`);
  const type = pickType(typeRoll, weights);

  // Encounter danger: a danger floor + system danger + a hostile-rep nudge,
  // with a small deterministic jitter so two equally-dangerous systems differ.
  const repNudge =
    playerState.pirateRep && playerState.pirateRep < 0
      ? Math.min(0.2, -playerState.pirateRep / 500)
      : 0;
  const jitter = hashUnit(`${system.id}:${seedKey}:danger`) * 0.15;
  const danger = clamp01(0.15 + sysDanger * 0.7 + repNudge + jitter);

  // Reward scale: ≥1, lifted by system danger and player level (risk↔reward).
  const level = Math.max(1, playerState.level ?? 1);
  const rewardScale =
    1 +
    sysDanger * config.rewardDangerMult +
    (level - 1) * config.rewardLevelMult;

  return {
    id: `enc:${system.id}:${seedKey}`,
    type,
    systemId: system.id,
    danger,
    rewardScale,
  };
}
