import { hashStr } from "@/utils/hashStr";
import { ResourceType } from "@/types";
import type { Encounter, EncounterType } from "./encounterGenerator";

export type EncounterChoice = "engage" | "ignore";

export type EncounterOutcomeKind =
  | "salvage" // derelict, good
  | "trap" // derelict, bad → combat
  | "bonus" // anomaly, good
  | "hazard" // anomaly, bad (non-combat penalty)
  | "rescue" // distress, good (+rep)
  | "ambush" // distress, bad → combat
  | "ignored"; // chose to leave

export interface EncounterCargoReward {
  type: ResourceType;
  amount: number;
}

export interface EncounterOutcome {
  kind: EncounterOutcomeKind;
  credits?: number;
  cargo?: EncounterCargoReward[];
  reputationDelta?: number;
  startCombat?: boolean;
  message: string;
}

export interface EncounterOutcomeConfig {
  derelictBaseCredits: number;
  derelictBaseCargo: number;
  anomalyBaseCredits: number;
  anomalyHazardCredits: number;
  distressBaseCredits: number;
  distressRepGain: number;
  badChanceFloor: number;
  dangerBadMult: number;
  maxBadChance: number;
}

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

function pickFrom<T>(pool: T[], roll: number): T {
  const i = Math.min(pool.length - 1, Math.floor(roll * pool.length));
  return pool[i];
}

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
