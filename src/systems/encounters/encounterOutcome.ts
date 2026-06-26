import { hashStr } from "@/utils/hashStr";
import { ResourceType } from "@/types";
import type { Encounter, EncounterType } from "./encounterGenerator";

/**
 * Exploration-encounter outcome resolver (pure).
 *
 * The companion to `encounterGenerator.ts`: given a rolled `Encounter` (which
 * carries the `danger` / `rewardScale` the generator stamped on it) and the
 * player's binary `choice` (engage it, or leave), it computes the payoff —
 * signed credits, looted cargo, a reputation nudge, and whether the encounter
 * spills into combat.
 *
 * Pure: no GameEngine/PixiJS/DOM coupling. Randomness is injected as an `rng()`
 * `0..1` source so every branch is unit-testable with a fixed value; the default
 * is a **deterministic** PRNG seeded off `encounter.id`, so an un-injected call is
 * still replay-stable. The caller (Task 3 wiring) applies the result through the
 * existing seams — banking `adjustPlayerCredits` for `credits`, the cargo hold for
 * `cargo`, `Player.adjustReputation` for `reputationDelta`, and `CombatModule` when
 * `startCombat` is set — so this file adds **no new economy plumbing**.
 *
 * Branch map (engaging an encounter):
 * - derelict → `salvage` (credits + cargo) | `trap` (combat, the hulk was bait)
 * - anomaly  → `bonus` (credits/data) | `hazard` (a non-combat penalty)
 * - distress → `rescue` (credits + rep) | `ambush` (combat, a faked distress call)
 * Ignoring any encounter is always the neutral `ignored` outcome.
 */

/** The player's response to a presented encounter. */
export type EncounterChoice = "engage" | "ignore";

/** What actually happened — the discriminator the caller maps to UI/i18n. */
export type EncounterOutcomeKind =
  | "salvage" // derelict, good
  | "trap" // derelict, bad → combat
  | "bonus" // anomaly, good
  | "hazard" // anomaly, bad (non-combat penalty)
  | "rescue" // distress, good (+rep)
  | "ambush" // distress, bad → combat
  | "ignored"; // chose to leave

/** A looted/lost cargo stack (positive = gained, negative = lost). */
export interface EncounterCargoReward {
  type: ResourceType;
  amount: number;
}

/** The resolved payoff the caller applies through the existing seams. */
export interface EncounterOutcome {
  kind: EncounterOutcomeKind;
  /** Signed whole-credit delta (salvage payout, hazard repair cost). Omitted ⇒ 0. */
  credits?: number;
  /** Cargo gained (positive amount). Omitted ⇒ none. */
  cargo?: EncounterCargoReward[];
  /**
   * Signed reputation delta to apply in wiring (Task 3 picks the faction —
   * typically the system owner / a lawful faction for a rescue). Omitted ⇒ 0.
   */
  reputationDelta?: number;
  /** True ⇒ the encounter becomes a fight (`CombatModule`). A trap or an ambush. */
  startCombat?: boolean;
  /** Short human-readable result (English; the caller maps it to i18n / a toast). */
  message: string;
}

export interface EncounterOutcomeConfig {
  /** Base salvage credits for a derelict (before `rewardScale`). */
  derelictBaseCredits: number;
  /** Base salvage cargo units for a derelict (before `rewardScale`). */
  derelictBaseCargo: number;
  /** Base credits/data payout for scanning an anomaly (before `rewardScale`). */
  anomalyBaseCredits: number;
  /** Repair cost (applied as a negative credit delta) for an anomaly hazard. */
  anomalyHazardCredits: number;
  /** Base reward credits for answering a distress call (before `rewardScale`). */
  distressBaseCredits: number;
  /** Base reputation gain for a successful rescue (before `rewardScale`). */
  distressRepGain: number;
  /** Minimum chance an engaged encounter turns bad (at zero danger). */
  badChanceFloor: number;
  /** Extra bad-outcome chance per unit encounter danger. */
  dangerBadMult: number;
  /** Hard ceiling on the bad-outcome chance after danger scaling. */
  maxBadChance: number;
}

/**
 * Default tuning. Standalone so the pure resolver has a sensible default for
 * tests/callers; the balance pass (Task 4) mirrors it into `balance.ts` as the
 * single source of truth for live wiring.
 */
export const DEFAULT_ENCOUNTER_OUTCOME_CONFIG: EncounterOutcomeConfig = {
  derelictBaseCredits: 400,
  derelictBaseCargo: 3,
  anomalyBaseCredits: 300,
  anomalyHazardCredits: 250,
  distressBaseCredits: 500,
  distressRepGain: 5,
  badChanceFloor: 0.1,
  dangerBadMult: 0.6,
  maxBadChance: 0.75,
};

/** Cargo pools each encounter flavour can yield (picked deterministically by rng). */
const CARGO_POOLS: Record<EncounterType, ResourceType[]> = {
  derelict: [
    ResourceType.METALS,
    ResourceType.ELECTRONICS,
    ResourceType.WEAPONS,
    ResourceType.ARTIFACTS,
  ],
  anomaly: [ResourceType.CRYSTALS, ResourceType.DATA_CORES],
  distress: [ResourceType.MEDICINE, ResourceType.ORGANICS],
};

/**
 * Deterministic mulberry32 PRNG seeded off a string key — the default `rng`
 * so an un-injected `resolveEncounter` is still replay-stable per encounter id.
 */
function makeRng(seedKey: string): () => number {
  let s = hashStr(seedKey) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a member of a non-empty pool from a `0..1` roll. */
function pickFrom<T>(pool: T[], roll: number): T {
  const i = Math.min(pool.length - 1, Math.floor(roll * pool.length));
  return pool[i];
}

/**
 * Resolve a presented encounter into its payoff.
 *
 * `rng` defaults to a deterministic PRNG seeded off `encounter.id`; inject a
 * fixed source (e.g. `() => 0`) to drive a specific branch in a test. Bad-outcome
 * odds rise with `encounter.danger`; payoff magnitudes rise with
 * `encounter.rewardScale`. Credits are always whole (currency is integer).
 */
export function resolveEncounter(
  encounter: Encounter,
  choice: EncounterChoice,
  rng: () => number = makeRng(encounter.id),
  config: EncounterOutcomeConfig = DEFAULT_ENCOUNTER_OUTCOME_CONFIG,
): EncounterOutcome {
  if (choice === "ignore") {
    return { kind: "ignored", message: "You leave the encounter behind." };
  }

  const scale = Math.max(1, encounter.rewardScale);
  const badChance = Math.min(
    config.maxBadChance,
    config.badChanceFloor + clamp01(encounter.danger) * config.dangerBadMult,
  );
  const isBad = rng() < badChance;
  const cargoRoll = rng();

  switch (encounter.type) {
    case "derelict": {
      if (isBad) {
        return {
          kind: "trap",
          startCombat: true,
          message: "The derelict was bait — hostiles power up as you dock.",
        };
      }
      const credits = Math.round(config.derelictBaseCredits * scale);
      const amount = Math.max(1, Math.round(config.derelictBaseCargo * scale));
      return {
        kind: "salvage",
        credits,
        cargo: [{ type: pickFrom(CARGO_POOLS.derelict, cargoRoll), amount }],
        message: "You strip the derelict for credits and cargo.",
      };
    }

    case "anomaly": {
      if (isBad) {
        return {
          kind: "hazard",
          credits: -Math.round(config.anomalyHazardCredits * scale),
          message: "The anomaly flares — your systems take damage.",
        };
      }
      const credits = Math.round(config.anomalyBaseCredits * scale);
      const amount = Math.max(1, Math.round(scale));
      return {
        kind: "bonus",
        credits,
        cargo: [{ type: pickFrom(CARGO_POOLS.anomaly, cargoRoll), amount }],
        message: "You scan the anomaly and recover valuable data.",
      };
    }

    case "distress":
    default: {
      if (isBad) {
        return {
          kind: "ambush",
          startCombat: true,
          message: "The distress call was a trap — raiders decloak.",
        };
      }
      const credits = Math.round(config.distressBaseCredits * scale);
      const reputationDelta = Math.max(
        1,
        Math.round(config.distressRepGain * scale),
      );
      return {
        kind: "rescue",
        credits,
        reputationDelta,
        cargo: [{ type: pickFrom(CARGO_POOLS.distress, cargoRoll), amount: 1 }],
        message: "You rescue the crew — credits and goodwill earned.",
      };
    }
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
