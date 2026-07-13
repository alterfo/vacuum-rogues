import { z } from "zod";
import type { GameMode, NpcSizeTier, ResourceType } from "@/types";
import type { EncounterConfig } from "@/systems/encounters/encounterGenerator";
import type { EncounterOutcomeConfig } from "@/systems/encounters/encounterOutcome";
import { Faction } from "@/types/faction";

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
 * First in-game day the **apex engine** (`eq_engine_v`) may appear in any shop
 * (`GearBase.minDay`, enforced by {@link ShopGenerator.generateShop}). The
 * natural tech climb reaches tech 7 in well under a year (research-lab systems
 * advance +1 tech / 50 days regardless of starting level), which made the
 * endgame 2× cruise speed available far too early. Gating the one apex engine
 * by calendar day — rather than slowing tech growth galaxy-wide, which would
 * delay every other tech-7/8 item — lands it around year 3 of the documented
 * 2–3-year campaign pacing. Tune here, never at call sites.
 */
export const APEX_ENGINE_MIN_DAY = 1050;

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

/**
 * Overmind size tiers (plan 20260709 Task 2): garrison/capture-fleet ships get
 * a small/medium/large tier by `weight` (small most common, hashed from the
 * ship id); `statMult` scales HULL off `ROLE_STATS[NpcRole.OVERMIND]`. Damage
 * deliberately does NOT scale with tier: the seeded letsplay campaign gates
 * and the seeded siege tests red on any garrison damage change (both up and
 * redistributed — see the ROLE_STATS[OVERMIND] comment and garrisonBudOff's
 * 20-tick capture window), empirically re-confirmed while landing this table.
 * Scale damage only with those gates re-run.
 */
export const OVERMIND_SIZE_TIERS: Record<
  "small" | "medium" | "large",
  { statMult: number; weight: number }
> = {
  small: { statMult: 0.8, weight: 50 },
  medium: { statMult: 1.0, weight: 35 },
  large: { statMult: 1.3, weight: 15 },
};

/**
 * The OVERMIND-core boss tier's fixed stats — the single source for what was an
 * ad-hoc override in OvermindBossController. Real-time combat does not model
 * shields, so the old hex encounter's 150-shield layer is folded into the hull
 * (300 + 150 = 450 effective HP); damage 45 as before.
 */
export const OVERMIND_BOSS_TIER = { hull: 450, damage: 45 } as const;

/**
 * Size-tier-scaled research-substance loot (plan 20260709 Task 5): bigger
 * Overmind hulls drop more/better artifacts for research-station upgrades.
 * `artifactChanceMult` scales {@link ARTIFACT_DROP_CHANCE} (capped at 1.0 by
 * the consumer); `bonusLootRolls` adds guaranteed loot items on top of the
 * flat 0–2 count roll. `small` is deliberately the unchanged flat baseline
 * (mult 1, no bonus) so a garrison-ship kill pays exactly what it does today;
 * `boss` caps the chance at 1.0 AND guarantees ≥1 loot roll, so a boss kill
 * always yields artifacts. A ship with no `sizeTier` (old save) also falls
 * back to the flat baseline. Only `LootDropHandler.spawn()` consumes this —
 * non-Overmind ships never roll artifacts and ignore the table entirely.
 */
export const OVERMIND_ARTIFACT_DROP: Record<
  NpcSizeTier,
  { artifactChanceMult: number; bonusLootRolls: number }
> = {
  small: { artifactChanceMult: 1.0, bonusLootRolls: 0 },
  medium: { artifactChanceMult: 1.4, bonusLootRolls: 0 },
  large: { artifactChanceMult: 2.0, bonusLootRolls: 1 },
  boss: { artifactChanceMult: 4.0, bonusLootRolls: 2 },
};

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
   * threat stays upgrade-gated: the mid engine `eq_engine_iii` (tech 5, 0.176)
   * stays below it, and only the rare, very-expensive apex engine `eq_engine_v`
   * (tech 7, 0.22 — a thin 10% margin) finally *out-runs* it — the reward for
   * the long, day-gated (`APEX_ENGINE_MIN_DAY`) climb to top tech.
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
  /**
   * Fraction of a weapon's fire interval pre-charged into its cold-start timer
   * when combat begins ({@link CombatModule.addCombatant}), applied only to
   * weapons whose `cooldownTurns > 1`. A `cooldownTurns:1` weapon's interval
   * already equals one turn (`combatFireIntervalMs`), so it keeps the old flat
   * cold-start unchanged; a slower weapon (e.g. `cooldownTurns:3`, 7500ms) would
   * otherwise force the full interval's wait for its first shot even after the
   * ship already spent time closing to range — this halves that wait so first
   * contact reads as prompt rather than a stall.
   */
  combatEngagePrechargeFraction: 0.5,
  /**
   * Round-based combat (campaign Task 9 (v)): the max fraction of the player's
   * MAX hull that a single **combat round** may remove before the module halts
   * fire and raises a fresh reaction window (an active-pause re-raise for the
   * live player, a decision turn for the headless agent). Because it is < 1, a
   * ship can NEVER drop from full hull to zero inside one resolution step — the
   * defender always gets a flee/fight decision between rounds. A committed fight
   * (repeatedly choosing to fight on) still loses across multiple rounds, so
   * fleeing has a cost — it is an escape window, not invulnerability. Active
   * only in campaign-aware combat (the CombatModule's `getCampaignPeakPower`
   * dep is wired); legacy DI sites without it keep the flat real-time fight.
   *
   * Sized BELOW the policy's `LOW_HULL_FRACTION` flee threshold (0.35) so a weak
   * ship reaches a reaction window inside the flee band (hull < 0.35 while still
   * alive) and escapes, instead of a coarse round leaping past the band straight
   * to zero. Small enough for several windows from full hull; a committed fight
   * still loses over those rounds (total exchange is unchanged — no immunity).
   */
  combatRoundHullFraction: 0.34,
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
   * - CAPTURES_PER_TICK: frontier systems consumed per spread tick.
   * - LOSS_SHARE: Overmind share at/above which (past grace, big enough) the arc is lost.
   * - CONTAINED_SHARE: once the share peaked above this and is pushed back to/below it, the arc is contained.
   * - MIN_SYSTEMS: loss is suppressed on tiny/legacy maps below this system count.
   *
   * Pacing note (three-year-campaign plan, Task 3): the old fixed
   * OVERMIND_SPREAD_GRACE_DAYS / OVERMIND_SPREAD_INTERVAL_DAYS levers were
   * replaced by the adaptive schedule — grace is ADAPTIVE_GRACE_DAYS and the
   * interval is `adaptiveSpreadIntervalDays(day, dayZero, campaignPeakPower)`
   * (see the ADAPTIVE_* levers below and src/systems/campaign/adaptivePacing.ts).
   */
  OVERMIND_SPREAD_CAPTURES_PER_TICK: 1,
  // The galaxy is only truly lost when the Overmind has swallowed nearly all of
  // it — seeing half the systems still free while being told "you lost" reads as
  // a bug. 0.85 keeps the last stretch as a genuine losing state without
  // demanding a pedantic 100% (the final system can be unreachable/garrisoned).
  OVERMIND_SPREAD_LOSS_SHARE: 0.85,
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
   * Effective-HP multiplier for enemies in overmind/pirate-held systems at the
   * STRONG end of the adaptive scaling (three-year-campaign Task 4): the live
   * consumer is `hostileScaling(peakPower, mode)` → `CombatModule`, which lerps
   * from HOSTILE_SCALING_WEAK_MULT (powerless player) up to this value (maxed
   * player, ratcheted `campaignPeakPower` = 1). At 1.5× a top loadout (bastion
   * hull + plasma cannon) still clears a garrison ship while the fight is a
   * real cost — see `combatLiberation.test.ts` endpoints.
   */
  OVERMIND_COMBAT_HP_MULT: 1.5,
  /**
   * Damage multiplier for enemies in overmind/pirate-held systems at the STRONG
   * end of the adaptive scaling (same lerp as OVERMIND_COMBAT_HP_MULT).
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
 * Kept low (not 0) so the nebula backdrop art reads as the hero visual it's
 * meant to be — a heavy dimmer was drowning it out (2026-07-11 feedback).
 */
export const BACKGROUND_DIM = 0.12;

/**
 * Opacity of the nebula backdrop art sprite itself, independent of
 * {@link BACKGROUND_DIM}. Raised from the original 0.38 so the AI-generated
 * panorama actually reads as a visible nebula instead of a faint tint
 * (2026-07-11 feedback: the nebula should be a mesmerizing hero backdrop).
 */
export const NEBULA_BACKDROP_ALPHA = 0.62;

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
 * ("чуть больше пиратов и Сверхразума"). `hostileCombatMultiplier` composes on
 * top of the adaptive hostile combat lerp (`hostileScaling`, Task 4) — HARD
 * garrison fights hit/soak 25% harder at every power level. Tune here, never
 * at call sites.
 */
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

/**
 * ─── Campaign: adaptive difficulty — playerPowerIndex normalization ─────────
 * (three-year-campaign plan, Task 2)
 *
 * `playerPowerIndex` (src/systems/campaign/playerPower.ts) collapses the
 * player's material strength into one number in [0,1]:
 *
 *   index = clamp01( w.hull·norm(maxHull) + w.weapon·norm(weaponDamage)
 *                  + w.credits·norm(credits) + w.rank·norm(rank) )
 *
 * where norm(x) = clamp01((x − MIN) / (MAX − MIN)). The MINs anchor at the
 * starter fitting (corvette + pulse laser + STARTING_MONEY), so a fresh
 * captain reads ≈ 0; the MAXes anchor at the apex catalog gear (hull_bastion
 * 360 HP, twin torpedo launchers 2×55 dmg) and the NG+ credit-carry scale, so
 * a fully armed veteran saturates toward 1. The Overmind's spread cadence and
 * garrison scaling (Tasks 3–4) consume the RATCHETED index (campaignPeakPower
 * — never decreases within a run), so selling gear cannot soften the front.
 */
export const POWER_INDEX_WEIGHTS = {
  hull: 0.35,
  weapon: 0.35,
  credits: 0.15,
  rank: 0.15,
} as const;
/** Starter corvette hull anchor — derived maxHull of a fresh fitting. */
export const POWER_INDEX_HULL_MIN = 130;
/** Apex hull anchor — hull_bastion (360 HP). */
export const POWER_INDEX_HULL_MAX = 360;
/** Starter weapon anchor — wpn_pulse (14 dmg). */
export const POWER_INDEX_WEAPON_MIN = 14;
/** Apex installed-damage anchor — two top launchers (2 × 55). */
export const POWER_INDEX_WEAPON_MAX = 110;
/** Starter capital anchor — STARTING_MONEY. */
export const POWER_INDEX_CREDITS_MIN = 1000;
/** War-chest saturation — the NG+ credit-carry cap / apex-gear savings scale. */
export const POWER_INDEX_CREDITS_MAX = 50000;
/** Top rank index on the 0–7 ladder (RANK_THRESHOLDS). */
export const POWER_INDEX_RANK_MAX = 7;
/**
 * ─── Campaign: adaptive Overmind spread pacing — the 2–3-year clock ─────────
 * (three-year-campaign plan, Task 3)
 *
 * The EOD arc drive (`DayTickController.advanceOvermindArc`) no longer uses a
 * fixed grace/interval: the spread cadence is
 * `adaptiveSpreadIntervalDays(day, dayZero, campaignPeakPower)`
 * (src/systems/campaign/adaptivePacing.ts) — a lerp from SLOW (weak player)
 * to FAST (armed player) on the RATCHETED power index, so growing strong
 * summons the war and selling gear never softens it. Two guards keep every
 * run resolvable within the 1080-day campaign ceiling:
 *  - grace: no spread for the first ADAPTIVE_GRACE_DAYS (year-1 growth room);
 *  - baseline creep: from ADAPTIVE_CREEP_START_DAY after day-zero the interval
 *    is floored at ADAPTIVE_CREEP_MIN_DAYS, so even a permanently idle run
 *    reaches the 0.85 loss share long before day 1080 (idle 24-system galaxy:
 *    ~7 captures in year 1–2, the rest on the creep floor ⇒ lost ≈ day 500).
 * Sized for a competent win in year 2–3; the Task 9 balance pass tunes these.
 */
/** Spread interval (days) faced by a powerless player (index 0). */
export const ADAPTIVE_SPREAD_SLOW_DAYS = 45;
/** Spread interval (days) faced by a maxed player (index 1). */
export const ADAPTIVE_SPREAD_FAST_DAYS = 10;
/** No arc spread for this many days past the arc's day-zero. */
export const ADAPTIVE_GRACE_DAYS = 90;
/** Days past the arc's day-zero after which the creep floor kicks in. */
export const ADAPTIVE_CREEP_START_DAY = 360;
/** Creep floor: the interval is capped at this once creep is active. */
export const ADAPTIVE_CREEP_MIN_DAYS = 12;
/**
 * Index at/above which the player counts as battle-ready for adaptive pacing.
 * Sized so the autopilot's battle-ready floor (hull ≥ 180, weapon ≥ 30 — see
 * BATTLE_READY_* in MemoryHeuristicPolicy) crosses it even with starter
 * credits/rank (index ≈ 0.134), while the starter fitting sits at 0. Keep
 * this in sync with BATTLE_READY_MAX_HULL/BATTLE_READY_WEAPON_DAMAGE — a
 * lowered hull floor without a matching drop here desyncs the escalation
 * notice / neutral-aggro shield / campaign-chain gate from the autopilot's
 * own definition of battle-ready (see playerPower.test.ts).
 */
export const POWER_INDEX_BATTLE_READY_THRESHOLD = 0.13;
/**
 * ─── Campaign: adaptive garrison & combat scaling ────────────────────────────
 * (three-year-campaign plan, Task 4)
 *
 * In-flight fights inside Overmind/pirate-held systems scale the hostiles'
 * effective HP and damage by `hostileScaling(peakPower, gameMode)`
 * (src/systems/campaign/hostileScaling.ts): a lerp from WEAK_MULT (powerless
 * player) up to the full OVERMIND_COMBAT_HP_MULT / OVERMIND_COMBAT_DAMAGE_MULT
 * (maxed player), composed with the mode's `hostileCombatMultiplier`. The
 * power input is the RATCHETED `campaignPeakPower`, so selling gear never
 * softens a garrison. Overmind garrison COUNT also grows with the ratchet.
 */
/** Hostile-system HP/damage multiplier faced by a powerless player (index 0). */
export const HOSTILE_SCALING_WEAK_MULT = 0.9;
/** Extra Overmind garrison ships (added to [min,max]) at full power (index 1). */
export const OVERMIND_GARRISON_POWER_MAX_BONUS = 2;
/**
 * Mirror of `OVERMIND_GARRISON_POWER_MAX_BONUS`: Overmind garrison ships
 * SUBTRACTED from [min,max] at zero power (a powerless player faces a
 * smaller standing garrison), phasing out to 0 as power reaches 1 (campaign
 * win-rate architecture plan, Task 2). Placeholder starting magnitude —
 * mirrors the bonus's own size; Task 3 re-measures and tunes it against the
 * `letsplay:campaign` harness rather than guessing the final value here.
 */
export const OVERMIND_GARRISON_POWER_MAX_DISCOUNT = 1;
/**
 * ─── Campaign Task 9 (i): neutral-system combat gentling ─────────────────────
 * The Overview's "gentle while weak, relentless once armed" design applied
 * CONSISTENTLY: a weak ship takes reduced INCOMING hits *everywhere* — wandering
 * faction/pirate packs in NEUTRAL systems included, not only held-system
 * garrisons — ramping to full baseline as the ratcheted `campaignPeakPower`
 * grows. `neutralScaling(power, mode)` lerps the incoming-damage multiplier from
 * WEAK_MULT (powerless) to STRONG_MULT (maxed); offense is UNSCALED in neutral
 * space (this gentles survival, not the kill). STRONG_MULT stays 1.0 so a fully
 * armed ship faces byte-identical neutral combat on NORMAL/GOD (the held-system
 * 1.5× levers are the only place damage rises above baseline). This is the half
 * of the campaign deaths the held-system scaling never saw (Task 9 baseline: the
 * one-shot deaths split ≈50/50 held-garrison vs neutral wandering pack).
 */
/** Neutral-system incoming-damage multiplier faced by a powerless player (index 0). */
export const NEUTRAL_SCALING_WEAK_MULT = 0.4;
/** Neutral-system incoming-damage multiplier faced by a maxed player (index 1). */
export const NEUTRAL_SCALING_STRONG_MULT = 1.0;
/**
 * ─── Campaign Task 9 (iii): power-keyed neutral-pack aggro gating ─────────────
 * "A weak ship isn't hunted." A wandering NEUTRAL-system aggressor (a besieging
 * Overmind interceptor — npcSpeed 0.2, un-outrunnable by a starter ship's 0.11)
 * does NOT break orbit to chase a ship whose ratcheted `campaignPeakPower` is
 * below this threshold; the hunt switches on as the player arms (power ≥
 * threshold). This closes the neutral-space combat-EXPOSURE deaths that per-shot
 * gentling (Task 9 (i)) alone could not — a weak ship that is never chased never
 * eats the crossing volleys. Tied to the battle-ready band so pressure arrives
 * exactly as the ship becomes able to fight back. A captured system's standing
 * garrison (isHostileSystem) and an already-engaged combatant are NEVER shielded
 * — only the wandering neutral hunt. Inert without a wired campaign context
 * (legacy DI reads `undefined` ⇒ hunted, byte-identical).
 */
export const NEUTRAL_AGGRO_POWER_THRESHOLD = POWER_INDEX_BATTLE_READY_THRESHOLD;
/**
 * ─── Campaign: escalation notices ────────────────────────────────────────────
 * (three-year-campaign plan, Task 5)
 *
 * Adaptive difficulty must be *felt*, not silent: crossing these bands emits a
 * one-shot CAMPAIGN_ESCALATION news notice (src/systems/campaign/
 * escalationNotices.ts, driven each EOD by DayTickController). The share band
 * reuses OVERMIND_WARNING_THRESHOLD; the arc's `contained` status drives the
 * "final push available" notice — no extra lever needed for those two.
 */
/**
 * Ratcheted power at/above which "the Overmind has noticed you" fires. Tied to
 * the battle-ready band — the exact point where adaptive spread pacing and
 * garrison scaling start to bite, so the notice explains the difficulty change
 * the player is about to feel.
 */
export const ESCALATION_NOTICED_POWER = POWER_INDEX_BATTLE_READY_THRESHOLD;
/**
 * ─── Campaign: Overmind quest chain (scenario spine) ─────────────────────────
 * (three-year-campaign plan, Task 12)
 *
 * A 5–6 step narrative chain (distress → recon → requisition → liberation
 * support → counteroffensive → core assault) keyed to PLAYER MILESTONES, not
 * days, so it fits adaptive difficulty. Each step is a catalog board quest
 * offered by `getQuestBoard` only when the previous step is complete (tracked
 * in the already-persisted `questLog.completedQuests`) AND the milestone band
 * below is crossed — no new persisted field, no migration. See
 * `src/systems/quests/campaignChain.ts`.
 */
/**
 * Ratcheted power at/above which the arm-up dependent steps (first liberation
 * support onward) unlock — the player must be battle-ready before the chain
 * sends them into the war. Tied to the battle-ready band.
 */
export const CAMPAIGN_CHAIN_LIBERATION_POWER =
  POWER_INDEX_BATTLE_READY_THRESHOLD;
/**
 * Overmind share at/below which the final "core assault" step unlocks — the
 * front has been pushed back to a remnant and only the core remains.
 */
export const CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE = 0.15;
/**
 * Per-step base credit reward (index 0..5). Meaningful and rising: the
 * requisition run (step 3) pays the most so it can genuinely fund the arm-up it
 * hands the player toward; the core assault (step 6) pays a hero's bounty.
 */
export const CAMPAIGN_CHAIN_STEP_REWARDS = [1200, 1800, 6000, 3000, 4000, 8000];

/**
 * Per-system owner-faction weights for generation-time galaxy seeding. Every
 * system used to hardcode `ownerFaction = "INDEPENDENT"` — a galaxy with zero
 * faction presence anywhere. `INDEPENDENT` still gets the largest single share
 * (unclaimed frontier space is the norm), but the 5 playable factions now
 * split the remainder so faction territory actually exists on the star map.
 * `OVERMIND` is excluded — its ownership is a live capture state
 * (`Galaxy.overmindSystems`), never a generation-time roll.
 */
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
