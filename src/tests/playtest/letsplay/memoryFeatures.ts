/**
 * Letsplay engine — belief-derived (memory) features (dev-only).
 *
 * The agent is a POMDP solver: {@link observe} is egocentric and {@link AgentMemory}
 * is the explicit, inspectable belief state it carries across steps. The tiny MLP
 * stays small precisely because the memory is **structured state, not net weights** —
 * so the net only ever reads a short *featurised summary* of the notebook. This
 * module computes that summary: pure functions that turn an {@link AgentMemory}
 * (plus the current {@link Observation}) into a fixed-width, `[0,1]`-normalised
 * vector appended after the observation features in {@link featurize}.
 *
 * Each signal answers a human, multi-step question the memoryless features can't:
 *
 *  - **best known margin** — "where's the best buy→sell trade I've *seen*?" (+ a
 *    direction flag: am I standing on the planet I should buy at right now?);
 *  - **profit-if-sold-here** — "is the cargo I'm carrying worth selling here, given
 *    what I paid for it?" (uses the FIFO buy-price lots);
 *  - **cheapest-upgrade gap / goal progress** — "how much more do I need to afford
 *    the cheapest upgrade I know of, and how far along am I?";
 *  - **route danger to goal** — "is the system I'm heading to one I remember as
 *    dangerous?".
 *
 * Everything is pure and never invents an unseen fact: an empty notebook (a fresh
 * run, or `featurize(obs)` called with no memory) degrades every signal to a sane
 * `0` default. Lives under `src/tests/` and is dev-only.
 */
import type { ResourceType } from "@/types";
import type { Observation } from "./observe";
import type { AgentMemory, KnownOffer } from "./AgentMemory";
import { createMemory } from "./AgentMemory";

/** Number of belief-derived features appended after the observation features. */
export const MEMORY_FEATURE_LENGTH = 20;

/**
 * A "meaningful sum" of credits — the scale a realisable profit / shortfall is
 * normalised against so the signal saturates toward 1 at a sum worth acting on.
 */
const CREDIT_SCALE = 10_000;
/** Hostiles in a system that reads as "very dangerous" (the threat-feature scale). */
const DANGER_SCALE = 8;
/** Outstanding loan balance that reads as "large" (the debt-scale features saturate here). */
const LOAN_SCALE = 100_000;
/** Consecutive missed payments that reads as "in serious arrears". */
const MISSED_PAYMENTS_SCALE = 5;
/** Estimated held-cargo value that reads as "a big haul". */
const CARGO_VALUE_SCALE = 50_000;
/** Consecutive stagnant days that reads as "clearly stuck". */
const STAGNATION_DAYS_SCALE = 30;
/** Days-with-Overmind-pressure-observed that reads as "the arc has been live a long time". */
const OVERMIND_DAYS_SCALE = 100;
/**
 * Reachable-galaxy size the visited-fraction feature is normalised against.
 * Observation doesn't expose the live galaxy's system count to the pure belief
 * layer, so this mirrors `GAME_BALANCE.DEFAULT_SYSTEM_COUNT` (the galaxy-gen
 * default) rather than adding a new cross-layer import for one normaliser.
 */
const TOTAL_SYSTEMS_SCALE = 30;
/**
 * `maxHull` that reads as "a well-upgraded loadout" — the proxy for overall
 * equipment quality. No `ShipLoadout` market-value stat is exposed to the pure
 * decide layer, but `maxHull` already grows with both hull tier and defense
 * micromodules (catalog hull HP ranges ~55-360 before multipliers).
 */
const EQUIP_QUALITY_SCALE = 600;

/** Clamp a (possibly non-finite) value into `[0, 1]`. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The best realisable cross-planet arbitrage the agent *knows about*: across the
 * price book, for any one good, buy at the cheapest planet and sell at a **different**
 * planet for the most. Returns the good + the two planets + the absolute per-unit
 * `margin` and the profit `fraction` (`margin / sell`, in `[0,1]`). A good known at
 * only one planet yields nothing (you can't arbitrage where you can only round-trip
 * at a loss), so an empty / single-planet notebook returns a zero margin.
 */
export interface BestMargin {
  good: ResourceType | null;
  buyPlanet: string | null;
  sellPlanet: string | null;
  /** Absolute credits of profit per unit (`sell@sellPlanet − buy@buyPlanet`). */
  margin: number;
  /** `margin / sell`, clamped `[0,1]` — the trade's profit fraction. */
  fraction: number;
}

const NO_MARGIN: BestMargin = {
  good: null,
  buyPlanet: null,
  sellPlanet: null,
  margin: 0,
  fraction: 0,
};

export function bestKnownMargin(mem: AgentMemory): BestMargin {
  // Invert the price book into good → the planets that trade it.
  const byGood = new Map<
    ResourceType,
    { planet: string; buy: number; sell: number }[]
  >();
  for (const [planet, goods] of mem.priceBook) {
    for (const [good, rec] of goods) {
      const list = byGood.get(good) ?? [];
      list.push({ planet, buy: rec.buy, sell: rec.sell });
      byGood.set(good, list);
    }
  }

  let best: BestMargin = NO_MARGIN;
  for (const [good, list] of byGood) {
    for (const buyAt of list) {
      for (const sellAt of list) {
        if (buyAt.planet === sellAt.planet) continue; // must be a real trip
        const margin = sellAt.sell - buyAt.buy;
        if (margin > best.margin) {
          best = {
            good,
            buyPlanet: buyAt.planet,
            sellPlanet: sellAt.planet,
            margin,
            fraction: sellAt.sell > 0 ? clamp01(margin / sellAt.sell) : 0,
          };
        }
      }
    }
  }
  return best;
}

/**
 * Profit (credits) realisable *right now* by selling every held lot at the current
 * landed planet's sell prices, valued against the price each lot was bought at.
 * Only counts goods this market actually buys; a lot worth less than it was paid for
 * contributes `0` (a human wouldn't sell at a loss). `0` when not landed / no lots.
 */
export function profitIfSoldHere(obs: Observation, mem: AgentMemory): number {
  const market = obs.currentPlanet?.market;
  if (!market || mem.inventoryLots.length === 0) return 0;
  const sellOf = new Map<ResourceType, number>();
  for (const g of market) sellOf.set(g.resource, g.sell);

  let profit = 0;
  for (const lot of mem.inventoryLots) {
    const sell = sellOf.get(lot.good);
    if (sell === undefined) continue;
    const gain = (sell - lot.buyPrice) * lot.qty;
    if (gain > 0) profit += gain;
  }
  return profit;
}

/** The cheapest upgrade/equipment offer the agent has seen, or `null` if none. */
export function cheapestKnownOffer(mem: AgentMemory): KnownOffer | null {
  let best: KnownOffer | null = null;
  for (const o of mem.knownOffers) {
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

/**
 * The system the agent is currently working toward: the target of its first active
 * quest if it has one, else its current system (i.e. no travel goal). Used to ask
 * the threat map whether the route's destination is one it remembers as dangerous.
 */
export function goalSystemId(obs: Observation): string | null {
  const quest = obs.quests.find((q) => q.targetSystemId);
  if (quest?.targetSystemId) return quest.targetSystemId;
  return obs.player?.systemId ?? obs.system?.id ?? null;
}

/** Remembered hostile danger of the current goal system (raw count; `0` if unknown). */
export function routeDangerToGoal(obs: Observation, mem: AgentMemory): number {
  const goal = goalSystemId(obs);
  if (!goal) return 0;
  return mem.threatMap.get(goal) ?? 0;
}

/**
 * The worst hostile presence remembered across every system the agent has
 * knowledge of (raw count; `0` for an empty threat map). `Observation` never
 * surfaces neighbouring-system ids to the pure decide layer, so this is the
 * closest derivable proxy for "is there a known-dangerous system nearby" —
 * the worst danger anywhere in explored territory, not literal graph adjacency.
 */
export function worstKnownThreat(mem: AgentMemory): number {
  let worst = 0;
  for (const v of mem.threatMap.values()) if (v > worst) worst = v;
  return worst;
}

/** Best known sell price for `good` across every remembered planet (`0` if never seen). */
function bestKnownSellPrice(mem: AgentMemory, good: ResourceType): number {
  let best = 0;
  for (const goods of mem.priceBook.values()) {
    const rec = goods.get(good);
    if (rec && rec.sell > best) best = rec.sell;
  }
  return best;
}

/**
 * Estimated credits obtainable by selling every held lot at the best known
 * sell price *anywhere* remembered (not just the current planet — see
 * {@link profitIfSoldHere} for that narrower "sell right now" signal). A good
 * whose sell price was never observed values at what it was paid for (loot
 * defaults to `0`), so unpriced cargo isn't silently valued away.
 */
export function estimatedCargoValue(mem: AgentMemory): number {
  let value = 0;
  for (const lot of mem.inventoryLots) {
    const known = bestKnownSellPrice(mem, lot.good);
    value += (known > 0 ? known : lot.buyPrice) * lot.qty;
  }
  return value;
}

/**
 * The belief-derived feature block: a {@link MEMORY_FEATURE_LENGTH}-wide vector,
 * every component in `[0,1]`, appended to the observation features by
 * {@link featurize}. With no memory (default fresh notebook) every signal is its
 * sane `0` default — the agent simply "knows nothing yet".
 */
export function memoryFeatures(
  obs: Observation,
  mem: AgentMemory = createMemory(),
): number[] {
  const best = bestKnownMargin(mem);
  const landedId = obs.currentPlanet?.id ?? null;
  const atBuyPlanet =
    best.buyPlanet !== null && best.buyPlanet === landedId ? 1 : 0;

  const cheapest = cheapestKnownOffer(mem);
  const credits = obs.player?.credits ?? 0;
  const gap = cheapest ? Math.max(0, cheapest.price - credits) : 0;
  const gapFraction =
    cheapest && cheapest.price > 0 ? clamp01(gap / cheapest.price) : 0;
  const goalProgress =
    cheapest && cheapest.price > 0 ? clamp01(credits / cheapest.price) : 0;

  // 1 if holding cargo whose best sell planet is NOT in the current system, OR no
  // sell planet is known at all — the same "go warp to find a sell destination"
  // signal the BC teacher acts on (MemoryHeuristicPolicy's holdingForOtherSystem),
  // including its early-game cycle-breaker case (sellPlanet === null). Keeping
  // these two conditions in lockstep matters: the net is trained on this feature
  // explaining the teacher's "warp" label, so a mismatch here trains against the
  // very signal meant to justify the label.
  const sellInSystem =
    best.sellPlanet !== null &&
    (obs.system?.planets.some((p) => p.id === best.sellPlanet) ?? false);
  const holdingForOtherSystem =
    mem.inventoryLots.length > 0 && !sellInSystem ? 1 : 0;

  const loanBalanceFraction = clamp01(
    (mem.loanState?.balance ?? 0) / LOAN_SCALE,
  );
  const debtPressure = clamp01(
    (mem.loanState?.missedPayments ?? 0) / MISSED_PAYMENTS_SCALE,
  );
  const visitedSystemFraction = clamp01(
    mem.visitedSystemIds.size / TOTAL_SYSTEMS_SCALE,
  );
  const questDeliveryProgress =
    obs.quests.length > 0
      ? clamp01(mem.activeQuestDelivery.length / obs.quests.length)
      : 0;
  const nearestThreat = clamp01(worstKnownThreat(mem) / DANGER_SCALE);
  const cargoValue = clamp01(estimatedCargoValue(mem) / CARGO_VALUE_SCALE);
  const daysWithoutProgress = clamp01(
    mem.daysWithoutCreditGain / STAGNATION_DAYS_SCALE,
  );
  // Reputation with the game's two closest faction analogues for the design
  // table's "ranger" / "pirate" standing (there is no literal Ranger/Pirate
  // faction — see CJM-F's identical substitution in MemoryHeuristicPolicy).
  // Read off `mem` (mirrored from `obs.player` every fold — see
  // `AgentMemory.lastReputationBastions`) rather than `obs.player` directly,
  // so a fresh/empty notebook still degrades this to `0` like every other
  // memory-block signal; `getReputation` is [-100,100], only positive standing
  // registers (negative/neutral both read as "no leverage built yet").
  const repRangerFraction = clamp01(mem.lastReputationBastions / 100);
  const repPirateFraction = clamp01(mem.lastReputationSyndicate / 100);
  const overmindDaysPressure = clamp01(
    mem.overmindDaysSeen / OVERMIND_DAYS_SCALE,
  );
  // Loadout-quality proxy, also mirrored onto `mem` for the same zero-default
  // reason (`AgentMemory.lastMaxHull`).
  const equipQuality = clamp01(mem.lastMaxHull / EQUIP_QUALITY_SCALE);

  return [
    best.fraction, // best known cross-planet margin (profit fraction)
    atBuyPlanet, // direction — standing on the best-margin buy planet now
    clamp01(profitIfSoldHere(obs, mem) / CREDIT_SCALE), // profit if I sell held cargo here
    gapFraction, // credit gap to the cheapest known upgrade
    clamp01(routeDangerToGoal(obs, mem) / DANGER_SCALE), // remembered danger of the goal system
    goalProgress, // saving progress toward that upgrade
    holdingForOtherSystem, // holding cargo for a sell planet in another system → warp
    loanBalanceFraction, // outstanding loan balance
    debtPressure, // consecutive missed loan payments
    mem.deadlockDetected ? 1 : 0, // the sticky "nothing good to do" flag
    visitedSystemFraction, // fraction of the (assumed) galaxy explored so far
    questDeliveryProgress, // fraction of carried quests with a known delivery system
    nearestThreat, // worst remembered danger anywhere explored
    cargoValue, // estimated value of everything currently held
    daysWithoutProgress, // stagnation — consecutive no-credit-gain days
    repRangerFraction, // BASTIONS reputation proxy
    repPirateFraction, // SYNDICATE reputation proxy
    overmindDaysPressure, // days the Overmind arc has been observed active
    equipQuality, // maxHull-derived loadout-quality proxy
    0, // reserved, zero-padded
  ];
}
