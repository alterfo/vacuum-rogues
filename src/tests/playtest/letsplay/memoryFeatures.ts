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
export const MEMORY_FEATURE_LENGTH = 7;

/**
 * A "meaningful sum" of credits — the scale a realisable profit / shortfall is
 * normalised against so the signal saturates toward 1 at a sum worth acting on.
 */
const CREDIT_SCALE = 10_000;
/** Hostiles in a system that reads as "very dangerous" (the threat-feature scale). */
const DANGER_SCALE = 8;

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

  // 1 if holding cargo whose best sell planet is NOT in the current system — the
  // key signal that tells the net "warp to find the sell destination".
  const sellInSystem =
    best.sellPlanet !== null &&
    (obs.system?.planets.some((p) => p.id === best.sellPlanet) ?? false);
  const holdingForOtherSystem =
    mem.inventoryLots.length > 0 && best.sellPlanet !== null && !sellInSystem
      ? 1
      : 0;

  return [
    best.fraction, // best known cross-planet margin (profit fraction)
    atBuyPlanet, // direction — standing on the best-margin buy planet now
    clamp01(profitIfSoldHere(obs, mem) / CREDIT_SCALE), // profit if I sell held cargo here
    gapFraction, // credit gap to the cheapest known upgrade
    clamp01(routeDangerToGoal(obs, mem) / DANGER_SCALE), // remembered danger of the goal system
    goalProgress, // saving progress toward that upgrade
    holdingForOtherSystem, // holding cargo for a sell planet in another system → warp
  ];
}
