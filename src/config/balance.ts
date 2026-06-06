import { z } from "zod";

/**
 * Type-safe game balance constants.
 * Follows SRP: all balance numbers in one place, validated at startup.
 */
export const BalanceSchema = z.object({
  // Economy
  STARTING_MONEY: z.number().int().min(0).default(1000),
  MAX_INVENTORY_SLOTS: z.number().int().min(1).default(50),

  // Galaxy
  DEFAULT_SYSTEM_COUNT: z.number().int().min(1).max(100).default(30),
  MIN_SYSTEMS: z.number().int().min(1).default(5),
  MAX_SYSTEMS: z.number().int().min(1).default(100),

  // Travel
  WARP_FUEL_COST_CONNECTED: z.number().int().min(0).default(5),
  WARP_FUEL_COST_UNCONNECTED_BASE: z.number().int().min(0).default(10),
  WARP_FUEL_COST_UNCONNECTED_MULTIPLIER: z.number().min(0).default(2),

  // Combat
  MAX_EQUIPMENT_SLOTS: z.number().int().min(1).default(3),

  // Save
  MAX_SAVE_SLOTS: z.number().int().min(1).default(10),
  AUTO_SAVE_SLOT: z.string().default("auto"),
  EMERGENCY_SAVE_SLOT: z.string().default("_emergency"),

  // Quality
  DEFAULT_QUALITY_LEVEL: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

export type BalanceConfig = z.infer<typeof BalanceSchema>;

/**
 * Runtime-validated balance constants.
 * Throws if any value violates schema constraints.
 */
export const BALANCE: BalanceConfig = BalanceSchema.parse({
  STARTING_MONEY: 1000,
  DEFAULT_SYSTEM_COUNT: 30,
  WARP_FUEL_COST_CONNECTED: 5,
  WARP_FUEL_COST_UNCONNECTED_BASE: 10,
  WARP_FUEL_COST_UNCONNECTED_MULTIPLIER: 2,
  MAX_EQUIPMENT_SLOTS: 3,
});

/** Kill-point thresholds for ranks 0–7. */
export const RANK_THRESHOLDS = [
  0, 100, 250, 500, 1000, 2000, 4000, 8000,
] as const;

/** Display names for each rank tier. */
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

/** Minimum rank required to see elite quests (minRank = 3 → Ас). */
export const ELITE_QUEST_MIN_RANK = 3;

/** Player rank at which the government faction discount applies. */
export const RANK_DISCOUNT_THRESHOLD = 5;

/** Price multiplier for high-rank players (15% off). */
export const RANK_DISCOUNT_FACTOR = 0.85;

/**
 * System geometry constants. All measurements in world pixels.
 * Keep in sync with PlanetGenerator.ORBITAL_RADII (CLAUDE.md Rule 5).
 */
export const SYSTEM_GEOMETRY = {
  /** Innermost NPC wander radius; also innermost planet orbit. */
  innerRadius: 600,
  /** Outermost NPC wander radius; also outermost planet orbit. */
  outerRadius: 2500,
  /** System boundary (рубеж гиперпрыжка): ships enter/leave here. */
  boundaryRadius: 2800,
  /** Minimum approach distance to the star corona for route planning. */
  starAvoidRadius: 390,
  /** Planet orbital radii for up to 5 planets. */
  orbitRadii: [600, 1050, 1500, 1950, 2500] as const,
} as const;

/**
 * Gameplay balance constants used across scene and system layers.
 */
export const GAME_BALANCE = {
  /** World pixels a ship must travel for 1 in-game day to elapse. */
  pixelsPerDay: 500,
  /** NPC drift speed in px/ms. */
  npcSpeed: 0.2,
  /** Weapon engagement range in world px. */
  weaponRange: 240,
  /** Scanner (radar) range in world px. */
  scannerRange: 1200,
  /** Star sprite radius (visual, not physics). */
  starRadius: 170,
} as const;
