import { hashStr } from "@/utils/hashStr";

export type EncounterType = "derelict" | "anomaly" | "distress";

export interface EncounterSystemView {
  id: string;
  danger: number;
}

export interface EncounterPlayerState {
  level?: number;
  pirateRep?: number;
  stepsSinceLastEncounter?: number;
}

export interface Encounter {
  id: string;
  type: EncounterType;
  systemId: string;
  danger: number;
  rewardScale: number;
}

export interface EncounterConfig {
  baseChance: number;
  minGap: number;
  dangerChanceBoost: number;
  maxChance: number;
  weights: Record<EncounterType, number>;
  distressDangerWeight: number;
  rewardDangerMult: number;
  rewardLevelMult: number;
}

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

function hashUnit(key: string): number {
  return (hashStr(key) % 100000) / 100000;
}

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

export function rollEncounter(
  system: EncounterSystemView,
  seed: string | number,
  playerState: EncounterPlayerState = {},
  config: EncounterConfig = DEFAULT_ENCOUNTER_CONFIG,
): Encounter | null {
  const sysDanger = clamp01(system.danger);
  const seedKey = String(seed);

  const since = playerState.stepsSinceLastEncounter ?? Number.POSITIVE_INFINITY;
  if (since < config.minGap) return null;

  const chance = Math.min(
    config.maxChance,
    config.baseChance + sysDanger * config.dangerChanceBoost,
  );
  const occur = hashUnit(`${system.id}:${seedKey}:occur`);
  if (occur >= chance) return null;

  const weights: Record<EncounterType, number> = {
    derelict: config.weights.derelict,
    anomaly: config.weights.anomaly,
    distress: config.weights.distress + sysDanger * config.distressDangerWeight,
  };
  const typeRoll = hashUnit(`${system.id}:${seedKey}:type`);
  const type = pickType(typeRoll, weights);

  const repNudge =
    playerState.pirateRep && playerState.pirateRep < 0
      ? Math.min(0.2, -playerState.pirateRep / 500)
      : 0;
  const jitter = hashUnit(`${system.id}:${seedKey}:danger`) * 0.15;
  const danger = clamp01(0.15 + sysDanger * 0.7 + repNudge + jitter);

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
