import { z } from "zod";
import type { GameMode, ResourceType } from "@/types";
import type { EncounterConfig } from "@/systems/encounters/encounterGenerator";
import type { EncounterOutcomeConfig } from "@/systems/encounters/encounterOutcome";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BALANCE NOTE — Economy rebalance: homogeneous-but-expensive tech (2026-06).
 * (`docs/plans/20260625-economy-homogeneous-tech-start-speed.md`)
 *
 * Design feel: **harder to win, easier to play.** Four linked levers, all pure
 * config/catalog data (no persisted player fields ⇒ no save migration):
 *
 *  1. **Player ≥ basic-NPC speed.** A fresh starter ship (~0.11 px/ms with
 *     `eq_engine_i`) can always out-run a *basic* NPC — ordinary traders/patrols
 *     cruise at {@link GAME_BALANCE.npcBasicSpeed} (0.08), below the player. Only
 *     rare **interceptor-class** craft (OVERMIND/PIRATE) run at the faster
 *     {@link GAME_BALANCE.npcSpeed} (0.2); escaping one stays upgrade-gated. You
 *     are never randomly outclassed by a *common* ship from the start.
 *
 *  2. **Homogeneous galaxy tech.** Most of the galaxy runs similar mid-tech
 *     ({@link NPC_TECH_BAND} = tech 1–3, whole band below the rare
 *     threshold), so a common NPC never fields apex gear — uniform tech means
 *     you're not randomly outgunned wandering between systems.
 *
 *  3. **Rare, very expensive top tier.** The apex hull/engine/weapon sit at
 *     tech ≥ {@link RARE_TECH_THRESHOLD} (6), priced ≥ 4× the mid tier and gated
 *     to scarce high-end markets (a rare flag halves stock chance again in
 *     {@link ShopGenerator}). Only the wealthiest field them.
 *
 *  4. **Longer top-tech climb.** Income (quests + tamed trade/combat printers,
 *     see {@link LOCAL_DELIVERY_REWARD_MARGIN}/{@link ARTIFACT_DROP_CHANCE})
 *     vs. the steep apex prices makes the top hull «Бастион» a ~210-day goal and
 *     the hull+engine pair ~470 days — an order of magnitude beyond the old
 *     ~2-week buy. See {@link QUEST_BASE_REWARD} / {@link modelledDaysToAfford}.
 *
 * Tests assert the *relationships* (player ≥ NPC speed, steep top step, low tech
 * variance, longer days-to-top), not magnitudes, so these knobs stay tunable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
 * Progression feel (homogeneous-but-expensive): most of the galaxy runs similar
 * mid-tech ({@link NPC_TECH_BAND}), so a player is never randomly outclassed by a
 * *common* ship — but the rare apex hull/engine (tech ≥ {@link RARE_TECH_THRESHOLD})
 * is a long, earned climb only the richest field, gated to scarce high-end markets.
 *
 * Modelled active-player day-curve (≈ 1 quest per {@link QUEST_INTERVAL_DAYS} days,
 * ~680 cr/quest ⇒ ≈ 57 cr/day from quests alone; trade margins make the early tiers
 * faster but cannot buy a *rare* apex item that isn't stocked):
 *   Day 100 (~8 quests)  → ~5,400 cr earned  → mid-tier tech-3 gear (~2,000–5,000)
 *   Day 250 (~20 quests) → ~13,600 cr earned → tech-5 gear (~5,500–9,000)
 *   Day ~210 just for the apex hull «Бастион» (12,000); ~470 for the apex
 *     hull + apex engine «Тип-V» pair (~25,500) — an order of magnitude beyond the
 *     old ~2-week trade buy of the (then cheap, ubiquitous) top hull. The long climb
 *     is the point: harder to win, easier to play. See {@link modelledDaysToAfford}.
 *
 * Quest mix assumed: 60% 1-hop, 30% 2-hop, 10% 3-hop; 50% DELIVERY (×1.0), 30% BOUNTY (×1.6).
 * Average reward at this mix: ~680 credits/quest.
 */
export const QUEST_BASE_REWARD = 400;

/**
 * Modelled active-player quest cadence used to document the progression curve:
 * an engaged player completes roughly one quest every this-many game days.
 * Combined with the quest board's mean reward it yields a credits/day rate, the
 * single source of truth for {@link modelledDaysToAfford}. Pure data — no
 * persisted field, no migration.
 */
export const QUEST_INTERVAL_DAYS = 12;

/**
 * Pure days-to-save model: how many game days an active player needs to afford
 * `priceCredits` at the given average quest reward and the documented
 * one-quest-per-{@link QUEST_INTERVAL_DAYS}-days cadence. A conservative
 * lower bound (quest income only; ignores trade/bounty top-ups), used by the
 * progression test to assert the rare apex tech is now a *long* climb rather
 * than the old ~2-week buy.
 */
export function modelledDaysToAfford(
  priceCredits: number,
  avgQuestReward: number,
): number {
  if (avgQuestReward <= 0) return Number.POSITIVE_INFINITY;
  const incomePerDay = avgQuestReward / QUEST_INTERVAL_DAYS;
  return Math.ceil(priceCredits / incomePerDay);
}

/**
 * Additional credits per hyperjump to the target system.
 * Combined with QUEST_BASE_REWARD: a 1-hop DELIVERY yields 620 cr; a 2-hop BOUNTY yields ~1,632 cr.
 */
export const QUEST_REWARD_PER_JUMP = 220;

/**
 * Quest deadline budget (game days). A timed quest's deadline is
 * `BASE + jumps × PER_JUMP` (+ a small random buffer), where `jumps` is the REAL
 * number of hyperjumps the nav graph requires (the **undirected** warp distance —
 * see {@link jumpDistances}). The base covers picking up + the in-system legs at
 * each end; the per-jump term covers one hyperjump's travel. The form is BOUNDED
 * (linear in jumps, so a near 1-hop job stays time-pressured) yet always ≥ a
 * realistic round-trip budget for the advertised distance — fixing the
 * "1-2 advertised / 3-6 actual, 30-day deadline impossible" expiry trap.
 *
 * The deadline is deliberately DECOUPLED from the reward (which scales via
 * {@link QUEST_REWARD_PER_JUMP}); a longer deadline is never extra money.
 * At these values a 1-jump job gets 37-42 days, a 2-jump 53-58, a 3-jump 69-74.
 */
export const QUEST_DEADLINE_BASE_DAYS = 16;
export const QUEST_DEADLINE_PER_JUMP_DAYS = 16;

/** Min/max of the small random slack added on top of the deadline budget. */
export const QUEST_DEADLINE_BUFFER_MIN_DAYS = 5;
export const QUEST_DEADLINE_BUFFER_MAX_DAYS = 10;

/**
 * Faction reputation granted on quest SUCCESS — the recovery loop that mirrors
 * the expiry penalty (which only ever subtracts). Keyed by the same `factionId`
 * the board/landing gate read, so honest play visibly raises standing. Kept
 * DELIBERATELY MODEST: at +5 a −50 player needs ~10 successful quests to climb
 * back to 0, so recovery is earned over several quests, never in one — and the
 * [-100,100] rep clamp in {@link Player.adjustReputation} prevents overshoot.
 */
export const QUEST_REPUTATION_REWARD = 5;

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
 *
 * The market BUY price can run well above base: {@link TradeSystem.getMarketPrice}
 * clamps the demand/economy/drift-adjusted price to a hard ceiling of
 * `basePrice × 3.0`, and {@link TradeSystem.getBuyPrice} then applies a faction
 * buy multiplier whose maximum is 1.0 (every faction's `buyMultiplier ≤ 1.0`).
 * So the realistic worst-case purchase cost is `basePrice × 3.0` per unit. At
 * 1.5 the contract was a *guaranteed loss* whenever the market sat above 1.5×
 * base. The margin must therefore exceed 3.0 (a contract you must buy *for*
 * should never be a hidden loss — locked by `localDeliveryProfit.test.ts`).
 *
 * Oddity sweep (Task 4): narrowed 3.5 → 3.1 to tame the money-printer. At 3.5 the
 * payout sat ~17% above the absolute worst case and ~3.5× a *cold* market (base
 * price) — structural free profit. 3.1 keeps the contract just profitable against
 * the hot-market ceiling (~3% headroom over `× 3.0`) while shrinking the cold-
 * market windfall, so delivery is no longer a fat printer. It cannot go to/below
 * 3.0 without making the contract a loss in a hot market (the locked floor).
 */
export const LOCAL_DELIVERY_REWARD_MARGIN = 3.1;

/**
 * Tech level at and above which a piece of gear counts as the **rare, high-end
 * top tier** (`isRareGear` in {@link GearCatalog}). The economy is meant to feel
 * *homogeneous-but-expensive*: most of the galaxy runs similar mid-tech, and a
 * top-tier hull/engine is a long, earned climb — much pricier than the mid tier
 * (≥ 4×) and only stocked by the richest, high-end markets. The gear shop already
 * makes high-tech items rarer with tech level ({@link ShopGenerator.generateShop});
 * a rare flag halves that stock chance again, so the apex hull/engine truly is
 * something only the wealthiest can field. Keep in lockstep with the catalog's
 * `rare: true` apex items (top hull «Бастион», top engine «Двигатель Тип-V», top
 * weapon «торпеда», top грав-тяга) — those sit at the ceiling of the documented
 * tech-7/8 price band (≤ 14000), never above it.
 */
export const RARE_TECH_THRESHOLD = 6;

/**
 * Probability that killing an Overmind enemy drops artifacts (per kill).
 *
 * Oddity sweep (Task 4): lowered 0.4 → 0.25 to tame combat as a money-printer.
 * Artifacts double as a sellable good (`RESOURCE_BASE_PRICES.ARTIFACTS` = 1000 cr
 * each), so at 40% × an average of 2 per drop a kill was worth ~800 cr in raw
 * artifact value *on top of* gear loot. At 0.25 the expected payout is ~500 cr/kill
 * — a meaningful reward that still funds upgrades (first upgrade = 2 artifacts) over
 * a couple of combat sessions, without printing credits. Bounds locked by
 * `gearCurve.test.ts`; the combat-drop tests read this constant, not a literal.
 */
export const ARTIFACT_DROP_CHANCE = 0.25;
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
  ALLOWED_ORIGINS: [
    "vacuum-rogues.com",
    "alterfo.github.io",
    "localhost",
    "127.0.0.1",
  ] as string[],
} as const;

export const GAME_BALANCE = {
  /** World pixels a ship must travel for 1 in-game day to elapse. */
  pixelsPerDay: 500,
  /**
   * Drift/pursuit speed (px/ms) of an **interceptor-class** NPC — OVERMIND craft
   * and PIRATE raiders (see `npcCruiseSpeed`). Deliberately faster than the
   * fresh starter ship (~0.11 px/ms with `eq_engine_i`), so escaping an *elite*
   * threat stays upgrade-gated: the mid engine `eq_engine_iii` (tech 5) only
   * *ties* it, and only the rare, very-expensive apex engine `eq_engine_v`
   * (tech 7) finally *out-runs* it — the reward for the long climb to top tech.
   */
  npcSpeed: 0.2,
  /**
   * Drift/pursuit speed (px/ms) of a **basic** NPC (ordinary traders/patrols).
   * Kept below the fresh starter ship's speed (~0.11) so a new player can always
   * out-run a *basic* threat from the start — you are never outclassed by a
   * common ship, only by a rare interceptor. (Above 0.0; the combat-escape model
   * assumes a slower player can't flee `npcSpeed`, not this basic tier.)
   */
  npcBasicSpeed: 0.08,
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
  /**
   * Fraction of a destroyed NPC's credits the player salvages from the wreck
   * (Task 5: "killing pirates pays nothing" fix). Half the wreck's cash — a
   * meaningful reward for fighting, while the rest is "lost in the wreckage".
   */
  pirateSalvageFraction: 0.5,
  /**
   * Anti-farm cap: max salvage credits the player can collect **per galaxy day**.
   * Pirates respawn via garrisons, so an uncapped salvage would be an infinite
   * credit faucet; this bounds combat income to a sane credits/day (a handful
   * of kills) without making any single kill feel stingy.
   */
  pirateSalvageDailyCap: 1500,
  /**
   * Hands-on loot pickup radius (world px): a floating drop within this distance
   * of the ship is collected **without** a gravity tractor (Task 6: "yellow dot
   * can't be collected" fix — fly over it to grab it). A fitted tractor still
   * extends the reach to `gravTractorRange` (the radius is the *max* of the two),
   * so the tractor remains an upgrade rather than the only pickup path. Kept
   * below the smallest tractor (80) so the tractor is a meaningful range boost,
   * and tight enough that loot must be flown near — not vacuumed from afar.
   */
  lootPickupRadius: 45,
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
   * Overmind endgame-arc spread tuning (the escalating front driven each EOD by
   * `advanceOvermind`, `src/systems/overmind/overmindSpread.ts`). These mirror
   * `DEFAULT_OVERMIND_SPREAD_CONFIG`; the EOD drive reads them from here so the
   * arc pacing is tunable in one place (the balance pass tunes these values).
   *
   * - GRACE_DAYS: no spread for the first N days past the arc's day-zero.
   * - INTERVAL_DAYS: a spread tick only captures every N days.
   * - CAPTURES_PER_TICK: frontier systems consumed per spread tick.
   * - LOSS_SHARE: Overmind share at/above which (past grace, big enough) the arc is lost.
   * - CONTAINED_SHARE: once the share peaked above this and is pushed back to/below it, the arc is contained.
   * - MIN_SYSTEMS: loss is suppressed on tiny/legacy maps below this system count.
   */
  OVERMIND_SPREAD_GRACE_DAYS: 3,
  OVERMIND_SPREAD_INTERVAL_DAYS: 3,
  OVERMIND_SPREAD_CAPTURES_PER_TICK: 1,
  OVERMIND_SPREAD_LOSS_SHARE: 0.5,
  OVERMIND_SPREAD_CONTAINED_SHARE: 0.2,
  OVERMIND_SPREAD_MIN_SYSTEMS: 12,
  /**
   * New-Game+ carry-over after winning the Overmind arc (`newGamePlus.ts`).
   * Mirrors `DEFAULT_NEW_GAME_PLUS_CONFIG`; `GameEngine.startNewGamePlus` reads
   * them so the carry is tunable in one place.
   *
   * - CREDIT_CARRY_FRACTION: fraction of the won game's credits carried forward.
   * - CREDIT_CARRY_CAP: absolute cap on carried credits (a head-start, not a free win).
   */
  NEW_GAME_PLUS_CREDIT_CARRY_FRACTION: 0.5,
  NEW_GAME_PLUS_CREDIT_CARRY_CAP: 50000,
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
 * Exploration-encounter occurrence tuning — the single live source of truth for
 * how often derelict/anomaly/distress encounters fire and how they scale
 * (`docs/plans/20260625-exploration-encounters.md`). The live wiring
 * (`NpcShipManager.rollEntryEncounter`) passes this to the pure `rollEncounter`;
 * it **mirrors** `DEFAULT_ENCOUNTER_CONFIG` in `encounterGenerator.ts` (the
 * module's standalone default for tests/callers), with a parity test keeping the
 * two in lockstep. Tune the live rates/weights here, not at the call site.
 *
 * - baseChance/maxChance: per-entry encounter probability floor → danger ceiling.
 * - minGap: rate limit (no encounter within N entries of the last) — "spice, not a flood".
 * - dangerChanceBoost: extra chance per unit system danger.
 * - weights: relative derelict/anomaly/distress odds at safe (danger 0) space.
 * - distressDangerWeight: extra distress (ambush-bait) weight per unit danger.
 * - rewardDangerMult / rewardLevelMult: reward-scale lift per unit danger / level.
 */
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

/**
 * Exploration-encounter payoff tuning — the single live source of truth for what
 * engaging an encounter is worth and how likely it turns bad (trap/hazard/ambush)
 * (`docs/plans/20260625-exploration-encounters.md`). The live wiring
 * (`NpcShipManager.applyEncounterChoice`) passes this to the pure
 * `resolveEncounter`; it **mirrors** `DEFAULT_ENCOUNTER_OUTCOME_CONFIG` in
 * `encounterOutcome.ts`, kept in lockstep by the same parity test. Credits are
 * pre-`rewardScale` bases; bad-outcome odds rise with the encounter's danger.
 *
 * - *BaseCredits / *BaseCargo / distressRepGain: good-outcome payoffs.
 * - anomalyHazardCredits: the (negative) repair cost of an anomaly hazard.
 * - badChanceFloor/maxBadChance: bad-outcome probability floor → ceiling.
 * - dangerBadMult: extra bad-outcome chance per unit encounter danger.
 */
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
 * Pirate reputation gained each time the player buys off a shakedown
 * («Откупиться»). Paying tribute is the **repeatable recovery path** back toward
 * {@link GOOD_PIRATE_REP_THRESHOLD} (and thus landing access on pirate-captured
 * systems): a small, fixed per-interaction bump so a deeply-negative (−50) player
 * climbs back to landable only over **several** costly payoffs — never in one.
 * The per-interaction cap is the fixed gain itself (no scaling, no farming), and
 * the credit cost (`shakedownTribute`) stays meaningful — the standing is *bought*,
 * not free. Kept well below the threshold so a single payoff can't one-shot it.
 */
export const PIRATE_TRIBUTE_REP_GAIN = 3;

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
