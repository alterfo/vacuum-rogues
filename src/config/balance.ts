import { z } from "zod";
import type { GameMode, ResourceType } from "@/types";

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

/**
 * Base credit reward for a 0-jump quest (before type multiplier and variance).
 *
 * Target day-curve (active player ≈ 1 quest per 12 game days):
 *   Day 100 (~8 quests)  → ~5,400 credits earned  → can afford tech-3 gear (~2,000–5,000)
 *   Day 250 (~20 quests) → ~13,600 credits earned  → can afford tech-5 gear (~5,500–9,000)
 *   Day 450 (~37 quests) → ~25,100 credits earned  → can afford tech-7 gear (~10,000–14,000)
 *
 * Quest mix assumed: 60% 1-hop, 30% 2-hop, 10% 3-hop; 50% DELIVERY (×1.0), 30% BOUNTY (×1.6).
 * Average reward at this mix: ~680 credits/quest.
 */
export const QUEST_BASE_REWARD = 400;

/**
 * Additional credits per hyperjump to the target system.
 * Combined with QUEST_BASE_REWARD: a 1-hop DELIVERY yields 620 cr; a 2-hop BOUNTY yields ~1,632 cr.
 */
export const QUEST_REWARD_PER_JUMP = 220;

/** Minimum rank required to see elite quests (minRank = 3 → Ас). */
export const ELITE_QUEST_MIN_RANK = 3;

/**
 * Canonical base credit value per resource — the single source of truth for the
 * "reference" price a good is worth before market demand/supply modifiers.
 * Consumed by {@link TradeSystem} (its private `basePrices` map seeds from this)
 * and by the quest generator's local-delivery reward math, so a delivery
 * contract's payout always anchors to the same number the market charges.
 */
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

/**
 * Profit multiplier applied to a local-delivery ("Местный подряд") reward.
 * The player has to *buy* the cargo on the market before delivering it, so the
 * reward is `round(basePrice × targetAmount × LOCAL_DELIVERY_REWARD_MARGIN)`.
 * At 1.5 the payout covers the goods bought at base price plus a 50% margin,
 * leaving the contract profitable even when the market is somewhat above base.
 */
export const LOCAL_DELIVERY_REWARD_MARGIN = 1.5;

/**
 * Probability that killing an Overmind enemy drops artifacts (per kill).
 * At 40% drop chance with 1–3 artifacts per drop, an active player fighting
 * 2–3 Overmind encounters per day accumulates ~1.5–3 artifacts/day — enough
 * to afford the first upgrade (2 artifacts) after ~1–2 combat sessions.
 */
export const ARTIFACT_DROP_CHANCE = 0.4;
/** Minimum artifact count per Overmind-kill drop. */
export const ARTIFACT_DROP_COUNT_MIN = 1;
/** Maximum artifact count per Overmind-kill drop. */
export const ARTIFACT_DROP_COUNT_MAX = 3;

/** Player rank at which the government faction discount applies. */
export const RANK_DISCOUNT_THRESHOLD = 5;

/** Price multiplier for high-rank players (15% off). */
export const RANK_DISCOUNT_FACTOR = 0.85;

/** Base font sizes in px. Multiply by `currentFontScale()` from fontScale.ts for final size. */
export const BASE_FONT_SIZES = {
  /** Small labels, badges, mini-log */
  label: 11,
  /** Body text: descriptions, item names, dialogue */
  body: 13,
  /** Tooltip text */
  tooltip: 12,
  /** HUD buttons (play/pause, speed) */
  hud: 16,
  /** Section titles and headings */
  title: 18,
} as const;

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
export const GameConfig = {
  GAME_TITLE: "ВАКУУМНЫЕ ПРОЙДОХИ",
  ALLOWED_ORIGINS: ["vacuum-rogues.com", "localhost", "127.0.0.1"] as string[],
} as const;

export const GAME_BALANCE = {
  /** World pixels a ship must travel for 1 in-game day to elapse. */
  pixelsPerDay: 500,
  /** NPC drift speed in px/ms. */
  npcSpeed: 0.2,
  /** Weapon engagement range in world px. */
  weaponRange: 240,
  /** Real-time in-flight combat cadence: a ship fires once per this many ms while in range. */
  combatFireIntervalMs: 2500,
  /** Scanner (radar) range in world px. */
  scannerRange: 1200,
  /**
   * Distance (world px) at which a fight ends: an engaged combatant the player
   * opens beyond this is dropped from the combat set, and an aggressor that has
   * opened this far while being out-run breaks off its pursuit. ≈ scanner range
   * (a target off the scanner is no longer fightable), kept as its own tunable
   * constant so escape distance can be balanced independently of detection range.
   */
  combatEscapeRange: 1200,
  /** Star sprite radius (visual, not physics). */
  starRadius: 170,
  /** Gap (px) from planet surface to route endpoint — route preview stops at
   *  the edge rather than cutting through the disc. Auto-landing triggers
   *  earlier (LANDING_RANGE = 60 px), so the ship always lands before the
   *  approach waypoint is reached. */
  landingApproachOffset: 80,
  /** Default time-scale multiplier for ship physics (1.0 = real-time). */
  gameSpeedDefault: 1.0,
  /** Selectable time-scale steps cycled by the speed button in the HUD. */
  gameSpeedMultipliers: [1.0, 2.0, 4.0] as const,
  /** Fraction of base price deviation that marks a deal (20% = buy/sell 20% off/above average). */
  tradeDealThreshold: 0.2,
  /**
   * Player market impact: each unit traded nudges that planet's persistent
   * price multiplier so cross-planet arbitrage self-corrects. Buying drives the
   * local price UP (depletes stock); selling drives it DOWN (gluts the market).
   * Repeated round-trips therefore narrow the spread instead of widening it.
   */
  marketImpactPerUnit: 0.004,
  /**
   * Per-transaction ceiling on that nudge. Kept comfortably below the buy/sell
   * spread headroom so a single buy-then-sell on the SAME planet can never turn
   * a profit, even at the best faction sell multiplier (SYNDICATE 1.15:
   * 0.8 × 1.15 × (1 + 0.06) = 0.975 < 1). The nudge still accumulates across
   * separate visits up to the Market [0.4, 2.5] multiplier clamp.
   */
  marketImpactMaxPerTrade: 0.06,
  /** Grace period (game days) before OVERMIND can trigger a loss — gives the player time to develop. */
  OVERMIND_LOSS_GRACE_DAYS: 40,
  /** Minimum galaxy size (system count) for the OVERMIND loss condition to fire — prevents instant-loss on stale small saves. */
  OVERMIND_LOSS_MIN_SYSTEMS: 12,
  /** How often (game days) the self-balancing ownership tick fires. */
  OVERMIND_BALANCE_INTERVAL: 5,
  /**
   * Base capture probability per border faction system per tick.
   * Must exceed pRecaptureBase * averageDegree (≈3) at target share so the
   * equilibrium lands in the 15–25% band. Tuned: equilibrium ≈ 23% for d=3.
   * See docs/playtests/20260611-overmind-balance-findings.md for derivation.
   */
  OVERMIND_CAPTURE_PROB: 0.25,
  /**
   * Base recapture probability per border hostile system per tick.
   * Slightly above pCapture/3 so the topology-adjusted equilibrium lands
   * at ~17% (5 systems) for a 30-system galaxy with average degree 3.
   */
  OVERMIND_RECAPTURE_BASE_PROB: 0.12,
  /**
   * Negative-feedback strength: pCapture reduces and pRecapture increases by
   * (hostileShare × feedbackStrength). Higher = tighter equilibrium band.
   * At fs=4.0, pCapture reaches 0 at 25% share — a hard ceiling that
   * guarantees the balance tick never pushes the galaxy into majority.
   */
  OVERMIND_FEEDBACK_STRENGTH: 4.0,
  /**
   * Minimum hostile system count that the GameEngine floor maintains.
   * When the balance tick would drop to 0, this many systems are reseeded so
   * the recovery period stays within the 8–25% equilibrium band.
   */
  OVERMIND_FLOOR_MIN: 3,
  /**
   * Overmind share threshold at which the star map shows a warning indicator.
   * At 0.35 (35%) the player gets ~15% headroom before the 50% loss condition,
   * enough time to liberate one or two systems before the game ends.
   */
  OVERMIND_WARNING_THRESHOLD: 0.35,
  /**
   * HP and shields multiplier applied to enemies in overmind/pirate-controlled
   * systems. Makes early-game players unable to liberate systems solo while
   * a fully geared player (bastion hull + plasma cannon) can win.
   */
  OVERMIND_COMBAT_HP_MULT: 1.5,
  /**
   * Damage multiplier applied to enemies in overmind/pirate-controlled systems.
   * At 1.5× the default enemy deals enough damage to defeat an early scout hull.
   */
  OVERMIND_COMBAT_DAMAGE_MULT: 1.5,
  /**
   * Trade-route rumor lifecycle (living-trade-economy). A route's neutral spread
   * must EXCEED `rumorMarginOpen` (%) to be published as a TRADE_OPPORTUNITY
   * rumor, and an already-open rumor closes ("акция закончилась") once its
   * re-scored spread falls to/below `rumorMarginExpire` (%). The open threshold
   * sits comfortably above the expire threshold so player+NPC trade can close
   * the spread through that hysteresis band before the rumor expires.
   */
  rumorMarginOpen: 25,
  /** Margin (%) at/below which an active route rumor expires. */
  rumorMarginExpire: 10,
  /** Maximum number of TRADE_OPPORTUNITY rumors active at once. */
  rumorMaxActive: 4,
  /**
   * NPC trader reaction to route rumors (living-trade-economy). A TRADER's
   * per-departure chance to divert onto the most-profitable active rumor is
   * `clamp(rumorNpcBaseChance + rumorNpcMarginScale × max(0, marginPct −
   * rumorMarginExpire), 0, rumorNpcMaxChance)`. Anchoring the scale to the margin
   * *above* the expire threshold makes the pull taper to ~`rumorNpcBaseChance`
   * (almost none) as a rumor's spread closes toward expiry, while a fat fresh
   * margin pulls a sizeable fraction of passing traders.
   */
  rumorNpcBaseChance: 0.02,
  /** Added reaction probability per percentage-point of margin above expiry. */
  rumorNpcMarginScale: 0.02,
  /** Hard cap on a trader's per-departure rumor-reaction probability. */
  rumorNpcMaxChance: 0.6,
} as const;

/**
 * Pirate reputation at/above which the player is treated as on good terms with
 * pirates. Shared "good pirate rep" gate between the faction-hostility AI plan
 * (pirates leave the player alone — no attack/ransom) and the captured-system
 * landing gate (player may land on pirate-captured planets). Reputation is
 * clamped −100..100; this sits clearly positive, well above the hostility floor
 * (`Player.isHostileTo` < −30).
 */
export const GOOD_PIRATE_REP_THRESHOLD = 30;

/**
 * Readability dimmer strength for the flight-scene sky (F2, 2026-06-10
 * letsplay): alpha of the full-screen black overlay mounted above the nebula
 * backdrop/clouds/star fields so the game layer (planets, ship, routes, NPCs)
 * stays readable against the bright panorama. 0 = no dimming, 1 = black sky.
 */
export const BACKGROUND_DIM = 0.45;

/**
 * Sun-avoidance tuning (Sprint 2, Task 3).
 *
 * `SUN_EXCLUSION_RADIUS` is the route-planning clearance: when a straight path
 * would pass within this distance of the star centre, the route bows around it
 * in a smooth arc tangent to this circle (see `avoidStarPath`). It is an alias
 * of `SYSTEM_GEOMETRY.starAvoidRadius` so the avoidance radius has a single
 * source of truth.
 */
export const SUN_EXCLUSION_RADIUS = SYSTEM_GEOMETRY.starAvoidRadius;

/**
 * Hull HP lost per contact tick while the ship sits inside the star's visual
 * radius (`GAME_BALANCE.starRadius`). Applied at most once per
 * `SUN_CONTACT_DAMAGE_INTERVAL_MS` of game time so soft-steering nudges or a
 * brief graze cost a predictable amount instead of draining the hull every
 * frame.
 */
export const SUN_CONTACT_HULL_DAMAGE = 5;

/** Minimum interval (game-time ms) between sun-contact hull-damage ticks. */
export const SUN_CONTACT_DAMAGE_INTERVAL_MS = 500;

/**
 * GOD-mode hull floor as a fraction of the ship's maxHull. In GOD mode a lethal
 * hit can never drop the hull below `ceil(maxHull × this)` (always ≥ 1 HP), so
 * the ship survives but is clearly crippled ("downed" — can't fire or hyperjump
 * until repaired above the floor). NORMAL/HARD have no floor (hull can reach 0).
 */
export const GOD_MODE_HULL_FLOOR_FRACTION = 0.05;

/**
 * Per-difficulty-mode hostile scaling. NORMAL and GOD are the baseline — they
 * reproduce today's exact hostile-system count and garrison sizes. HARD seeds
 * modestly more hostile (overmind/pirate) systems and larger standing garrisons
 * ("чуть больше пиратов и Сверхразума"). Tune here, never at call sites.
 */
export const DIFFICULTY_HOSTILE_SCALING: Record<
  GameMode,
  { hostileSystemMultiplier: number; garrisonBonus: number }
> = {
  GOD: { hostileSystemMultiplier: 1.0, garrisonBonus: 0 },
  NORMAL: { hostileSystemMultiplier: 1.0, garrisonBonus: 0 },
  HARD: { hostileSystemMultiplier: 1.5, garrisonBonus: 2 },
};

/**
 * Number of hostile systems to seed for a mode given a baseline count.
 * NORMAL/GOD return the baseline unchanged (today's behaviour); HARD scales it
 * up by {@link DIFFICULTY_HOSTILE_SCALING}'s multiplier (rounded). Pure.
 */
export function scaledHostileSystemCount(
  mode: GameMode,
  baseCount: number,
): number {
  const mult = DIFFICULTY_HOSTILE_SCALING[mode]?.hostileSystemMultiplier ?? 1.0;
  return Math.round(baseCount * mult);
}

/**
 * Garrison `[min, max]` ship range for a mode given the baseline range.
 * NORMAL/GOD return the baseline unchanged; HARD shifts both bounds up by the
 * mode's `garrisonBonus`. Pure.
 */
export function scaledGarrisonRange(
  mode: GameMode,
  baseMin: number,
  baseMax: number,
): { min: number; max: number } {
  const bonus = DIFFICULTY_HOSTILE_SCALING[mode]?.garrisonBonus ?? 0;
  return { min: baseMin + bonus, max: baseMax + bonus };
}

/**
 * For a given mode, choose the additional hostile systems to seed beyond the
 * baseline so the totals reach the HARD-scaled targets. `isolatedFirstIds` is
 * every system id ordered most-isolated-first (the same ordering the galaxy
 * generator uses to pick starting hostiles). Already-hostile ids are skipped.
 * NORMAL/GOD return empty arrays (no change → exactly today's counts). Pure.
 */
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
