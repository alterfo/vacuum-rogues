import { z } from "zod";
import type { GameMode, NpcSizeTier, ResourceType } from "@/types";
import type { EncounterConfig } from "@/systems/encounters/encounterGenerator";
import type { EncounterOutcomeConfig } from "@/systems/encounters/encounterOutcome";
import { Faction } from "@/types/faction";

export const BalanceSchema = z.object({
  STARTING_MONEY: z.number().int().min(0).default(1000),
  MAX_INVENTORY_SLOTS: z.number().int().min(1).default(50),

  DEFAULT_SYSTEM_COUNT: z.number().int().min(1).max(100).default(30),
  MIN_SYSTEMS: z.number().int().min(1).default(5),
  MAX_SYSTEMS: z.number().int().min(1).default(100),

  WARP_FUEL_COST_CONNECTED: z.number().int().min(0).default(5),
  WARP_FUEL_COST_UNCONNECTED_BASE: z.number().int().min(0).default(10),
  WARP_FUEL_COST_UNCONNECTED_MULTIPLIER: z.number().min(0).default(2),

  MAX_EQUIPMENT_SLOTS: z.number().int().min(1).default(3),

  MAX_SAVE_SLOTS: z.number().int().min(1).default(10),
  AUTO_SAVE_SLOT: z.string().default("auto"),
  EMERGENCY_SAVE_SLOT: z.string().default("_emergency"),

  DEFAULT_QUALITY_LEVEL: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

export type BalanceConfig = z.infer<typeof BalanceSchema>;

export const BALANCE: BalanceConfig = BalanceSchema.parse({
  STARTING_MONEY: 1000,
  DEFAULT_SYSTEM_COUNT: 30,
  WARP_FUEL_COST_CONNECTED: 5,
  WARP_FUEL_COST_UNCONNECTED_BASE: 10,
  WARP_FUEL_COST_UNCONNECTED_MULTIPLIER: 2,
  MAX_EQUIPMENT_SLOTS: 3,
});

export const RANK_THRESHOLDS = [
  0, 100, 250, 500, 1000, 2000, 4000, 8000,
] as const;

export const RANK_LABELS = [
  "Новобранец",
  "Пилот",
  "Ветеран",
  "Ас",
  "Мастер",
  "Командор",
  "Адмирал",
  "Легенда",
] as const;

export const QUEST_BASE_REWARD = 400;

export const QUEST_INTERVAL_DAYS = 12;

export function modelledDaysToAfford(
  priceCredits: number,
  avgQuestReward: number,
): number {
  if (avgQuestReward <= 0) return Number.POSITIVE_INFINITY;
  const incomePerDay = avgQuestReward / QUEST_INTERVAL_DAYS;
  return Math.ceil(priceCredits / incomePerDay);
}

export const QUEST_REWARD_PER_JUMP = 220;

export const QUEST_REWARD_ERA_START_DAY = 270;
export const QUEST_REWARD_ERA_DOUBLING_DAYS = 135;
export const QUEST_REWARD_ERA_MAX_MULT = 96;

export const TECH_UPLIFT_DAYS = 180;
export const TECH_UPLIFT_CAP = 8;

export const QUEST_DEADLINE_BASE_DAYS = 16;
export const QUEST_DEADLINE_PER_JUMP_DAYS = 16;

export const QUEST_DEADLINE_BUFFER_MIN_DAYS = 5;
export const QUEST_DEADLINE_BUFFER_MAX_DAYS = 10;

export const QUEST_REPUTATION_REWARD = 5;

export const ELITE_QUEST_MIN_RANK = 3;

export const RESOURCE_BASE_PRICES: Record<ResourceType, number> = {
  FUEL: 50,
  METALS: 100,
  CRYSTALS: 250,
  ORGANICS: 75,
  ARTIFACTS: 1000,
  WEAPONS: 500,
  MEDICINE: 150,
  ELECTRONICS: 300,
  LUXURY: 400,
  DATA_CORES: 600,
};

export const LOCAL_DELIVERY_REWARD_MARGIN = 3.1;

export const RARE_TECH_THRESHOLD = 6;

export const APEX_ENGINE_MIN_DAY = 550;

export const ARTIFACT_DROP_CHANCE = 0.25;
export const ARTIFACT_DROP_COUNT_MIN = 1;
export const ARTIFACT_DROP_COUNT_MAX = 3;

export const OVERMIND_SIZE_TIERS: Record<
  "small" | "medium" | "large",
  { statMult: number; weight: number }
> = {
  small: { statMult: 0.8, weight: 50 },
  medium: { statMult: 1.0, weight: 35 },
  large: { statMult: 1.3, weight: 15 },
};

export const OVERMIND_BOSS_TIER = { hull: 450, damage: 45 } as const;

export const OVERMIND_ARTIFACT_DROP: Record<
  NpcSizeTier,
  { artifactChanceMult: number; bonusLootRolls: number }
> = {
  small: { artifactChanceMult: 1.0, bonusLootRolls: 0 },
  medium: { artifactChanceMult: 1.4, bonusLootRolls: 0 },
  large: { artifactChanceMult: 2.0, bonusLootRolls: 1 },
  boss: { artifactChanceMult: 4.0, bonusLootRolls: 2 },
};

export const RANK_DISCOUNT_THRESHOLD = 5;

export const RANK_DISCOUNT_FACTOR = 0.85;

export const BASE_FONT_SIZES = {
  label: 11,
  body: 13,
  tooltip: 12,
  hud: 16,
  title: 18,
} as const;

export const SYSTEM_GEOMETRY = {
  innerRadius: 600,
  outerRadius: 2500,
  boundaryRadius: 2800,
  starAvoidRadius: 390,
  orbitRadii: [600, 1050, 1500, 1950, 2500] as const,
} as const;

export const BLACK_HOLE_SYSTEM_CHANCE = 0.08;
export const BLACK_HOLE_VISUAL_RADIUS = 130;
export const BLACK_HOLE_EVENT_HORIZON_RADIUS = 90;
export const BLACK_HOLE_JUMP_MISHAP_CHANCE = 0.015;
export const BLACK_HOLE_ARCADE_REWARD_LEVEL_BASE = 400;
export const BLACK_HOLE_ARCADE_REWARD_LEVEL_GROWTH = 1.06;
export const BLACK_HOLE_ARCADE_REWARD_WIN_BONUS = 100000;
export const BLACK_HOLE_ARCADE_REWARD_DEFEAT_SHARE = 0.5;

export const GRAPPLE_HOLD = {
  hullToThreshold: 0.5,
} as const;

export const GameConfig = {
  GAME_TITLE: "ВАКУУМНЫЕ ПРОЙДОХИ",
  ALLOWED_ORIGINS: [
    "vacuum-rogues.com",
    "alterfo.github.io",
    "localhost",
    "127.0.0.1",
  ] as string[],
} as const;

export const GAME_BALANCE = {
  pixelsPerDay: 500,
  npcSpeed: 0.2,
  npcBasicSpeed: 0.08,
  weaponRange: 240,
  combatFireIntervalMs: 2500,
  combatJoinFireStaggerMs: 300,
  combatMaxSimultaneousCombatants: 2,
  combatEngagePrechargeFraction: 0.5,
  combatRoundHullFraction: 0.34,
  scannerRange: 1200,
  combatEscapeRange: 1200,
  pirateSalvageFraction: 0.5,
  pirateSalvageDailyCap: 1500,
  lootPickupRadius: 45,
  starRadius: 170,
  landingApproachOffset: 80,
  gameSpeedDefault: 1.0,
  gameSpeedMultipliers: [1.0, 2.0, 4.0, 10.0] as const,
  tradeDealThreshold: 0.2,
  marketImpactPerUnit: 0.004,
  marketImpactMaxPerTrade: 0.06,
  OVERMIND_LOSS_GRACE_DAYS: 40,
  OVERMIND_LOSS_MIN_SYSTEMS: 12,
  OVERMIND_BALANCE_INTERVAL: 5,
  OVERMIND_CAPTURE_PROB: 0.25,
  OVERMIND_RECAPTURE_BASE_PROB: 0.12,
  OVERMIND_FEEDBACK_STRENGTH: 4.0,
  OVERMIND_FLOOR_MIN: 3,
  OVERMIND_WARNING_THRESHOLD: 0.35,
  OVERMIND_SPREAD_CAPTURES_PER_TICK: 1,
  OVERMIND_SPREAD_LOSS_SHARE: 1,
  OVERMIND_SPREAD_CONTAINED_SHARE: 0.2,
  OVERMIND_SPREAD_MIN_SYSTEMS: 12,
  NEW_GAME_PLUS_CREDIT_CARRY_FRACTION: 0.5,
  NEW_GAME_PLUS_CREDIT_CARRY_CAP: 50000,
  OVERMIND_COMBAT_HP_MULT: 1.5,
  OVERMIND_COMBAT_DAMAGE_MULT: 1.5,
  rumorMarginOpen: 25,
  rumorMarginExpire: 10,
  rumorMaxActive: 4,
  rumorNpcBaseChance: 0.02,
  rumorNpcMarginScale: 0.02,
  rumorNpcMaxChance: 0.6,
} as const;

export const COMBAT_ROUND_MS = 3000;

export const GRAVITY_ASSIST = {
  radiusMultiplier: 3.5,
  referenceRadius: 120,
  strengthPerMs: 0.00012,
  maxBoostPerMs: 0.00008,
} as const;

export const MISSILE_COMBAT = {
  speedPerMs: 0.32,
  baseHitChance: 0.95,
  minHitChance: 0.15,
  evasionPerPx: 0.0016,
  homingEvasionFactor: 0.35,
  maxRangeMultiplier: 2.5,
} as const;

export const AFTERBURNER = {
  speedMultiplier: 2.2,
  wearPerBurn: 0.12,
  minIntegrityToEngage: 0.05,
} as const;

export const COMBAT_CONSUMABLE = {
  shieldRestoreAmount: 120,
  aoeDamage: 60,
  aoeRadius: 220,
  weaponJamMs: 4000,
} as const;

export const COMBAT_COMMS = {
  surrenderHullThreshold: {
    TRADER: 0.6,
    PATROL: 0.35,
    RANGER: 0.3,
    PIRATE: 0.2,
    OVERMIND: 0,
  } as Readonly<Record<string, number>>,
  defaultSurrenderThreshold: 0.25,
  allyProximityRadius: 700,
  allyRoles: ["TRADER", "PATROL", "RANGER"] as readonly string[],
} as const;

export const BANKING = {
  rollPerTurnRate: 100,
  maxRollAngle: Math.PI / 6,
  rollSmoothingPerMs: 0.004,
} as const;

export const SHIELD_COMBAT = {
  shieldFlashMs: 260,
  shieldFlashPeakAlpha: 0.45,
  shieldFlashRadiusScale: 1.35,
  barWidth: 44,
  barHeight: 4,
  barGap: 2,
  barYOffset: 26,
} as const;

export const WEAPON_VFX = {
  distortionMinTech: 7,
} as const;

export const WRECK = {
  driftRetentionPerMs: 0.9994,
  lifeMs: 5000,
  fadeMs: 1200,
  spinRatePerSpeed: 4,
} as const;

export const ENCOUNTER_CONFIG: EncounterConfig = {
  baseChance: 0.15,
  minGap: 4,
  dangerChanceBoost: 0.25,
  maxChance: 0.6,
  weights: { derelict: 5, anomaly: 4, distress: 3 },
  distressDangerWeight: 6,
  rewardDangerMult: 1.5,
  rewardLevelMult: 0.1,
} as const;

export const ENCOUNTER_OUTCOME_CONFIG: EncounterOutcomeConfig = {
  derelictBaseCredits: 400,
  derelictBaseCargo: 3,
  anomalyBaseCredits: 300,
  anomalyHazardCredits: 250,
  distressBaseCredits: 500,
  distressRepGain: 5,
  badChanceFloor: 0.1,
  dangerBadMult: 0.6,
  maxBadChance: 0.75,
} as const;

export const GOOD_PIRATE_REP_THRESHOLD = 30;

export const PIRATE_TRIBUTE_REP_GAIN = 3;

export const BACKGROUND_DIM = 0.12;

export const NEBULA_BACKDROP_ALPHA = 0.62;

export const SUN_EXCLUSION_RADIUS = SYSTEM_GEOMETRY.starAvoidRadius;

export const SUN_CONTACT_HULL_DAMAGE = 5;

export const SUN_CONTACT_DAMAGE_INTERVAL_MS = 500;

export const GOD_MODE_HULL_FLOOR_FRACTION = 0.05;

export const DIFFICULTY_HOSTILE_SCALING: Record<
  GameMode,
  {
    hostileSystemMultiplier: number;
    garrisonBonus: number;
    hostileCombatMultiplier: number;
  }
> = {
  GOD: {
    hostileSystemMultiplier: 1.0,
    garrisonBonus: 0,
    hostileCombatMultiplier: 1.0,
  },
  NORMAL: {
    hostileSystemMultiplier: 1.0,
    garrisonBonus: 0,
    hostileCombatMultiplier: 1.0,
  },
  HARD: {
    hostileSystemMultiplier: 1.5,
    garrisonBonus: 2,
    hostileCombatMultiplier: 1.25,
  },
};

export function scaledHostileSystemCount(
  mode: GameMode,
  baseCount: number,
): number {
  const mult = DIFFICULTY_HOSTILE_SCALING[mode]?.hostileSystemMultiplier ?? 1.0;
  return Math.round(baseCount * mult);
}

export function scaledGarrisonRange(
  mode: GameMode,
  baseMin: number,
  baseMax: number,
): { min: number; max: number } {
  const bonus = DIFFICULTY_HOSTILE_SCALING[mode]?.garrisonBonus ?? 0;
  return { min: baseMin + bonus, max: baseMax + bonus };
}

export function additionalHostileSeeds(
  mode: GameMode,
  isolatedFirstIds: string[],
  overmindIds: string[],
  pirateIds: string[],
): { overmind: string[]; pirate: string[] } {
  const extraOvermind = Math.max(
    0,
    scaledHostileSystemCount(mode, overmindIds.length) - overmindIds.length,
  );
  const extraPirate = Math.max(
    0,
    scaledHostileSystemCount(mode, pirateIds.length) - pirateIds.length,
  );
  if (extraOvermind === 0 && extraPirate === 0) {
    return { overmind: [], pirate: [] };
  }
  const taken = new Set([...overmindIds, ...pirateIds]);
  const pool = isolatedFirstIds.filter((id) => !taken.has(id));
  return {
    overmind: pool.slice(0, extraOvermind),
    pirate: pool.slice(extraOvermind, extraOvermind + extraPirate),
  };
}

export const POWER_INDEX_WEIGHTS = {
  hull: 0.35,
  weapon: 0.35,
  credits: 0.15,
  rank: 0.15,
} as const;
export const POWER_INDEX_HULL_MIN = 130;
export const POWER_INDEX_HULL_MAX = 360;
export const POWER_INDEX_WEAPON_MIN = 14;
export const POWER_INDEX_WEAPON_MAX = 110;
export const POWER_INDEX_CREDITS_MIN = 1000;
export const POWER_INDEX_CREDITS_MAX = 50000;
export const POWER_INDEX_RANK_MAX = 7;
export const ADAPTIVE_SPREAD_SLOW_DAYS = 55;
export const ADAPTIVE_SPREAD_FAST_DAYS = 10;
export const ADAPTIVE_GRACE_DAYS = 90;
export const ADAPTIVE_CREEP_START_DAY = 540;
export const ADAPTIVE_CREEP_MIN_DAYS = 30;
export const POWER_INDEX_BATTLE_READY_THRESHOLD = 0.13;
export const HOSTILE_SCALING_WEAK_MULT = 0.5;
export const OVERMIND_GARRISON_POWER_MAX_BONUS = 2;
export const OVERMIND_GARRISON_POWER_MAX_DISCOUNT = 6;
export const OVERMIND_GARRISON_DISCOUNT_FLOOR = 1;
export const NEUTRAL_SCALING_WEAK_MULT = 0.4;
export const NEUTRAL_SCALING_STRONG_MULT = 1.0;
export const NEUTRAL_AGGRO_POWER_THRESHOLD = POWER_INDEX_BATTLE_READY_THRESHOLD;
export const ESCALATION_NOTICED_POWER = POWER_INDEX_BATTLE_READY_THRESHOLD;
export const CAMPAIGN_CHAIN_LIBERATION_POWER =
  POWER_INDEX_BATTLE_READY_THRESHOLD;
export const CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE = 0.15;
export const CAMPAIGN_CHAIN_STEP_REWARDS = [1200, 1800, 6000, 3000, 4000, 8000];

export const FACTION_DISTRIBUTION_WEIGHTS: ReadonlyArray<
  readonly [Faction, number]
> = [
  [Faction.INDEPENDENT, 10],
  [Faction.OUTLANDERS, 3],
  [Faction.BASTIONS, 3],
  [Faction.SYNDICATE, 3],
  [Faction.PARADOXES, 3],
  [Faction.PROGRESSORS, 3],
];
