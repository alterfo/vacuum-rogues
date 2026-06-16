import type { EconomyType } from "@/types";
import { ResourceType } from "@/types";
import { economyBaseline } from "@/domain/Market";
import { SeededRNG } from "@/utils/seededRNG";

/** The three parallel arrays that bring a stub market to life. */
export interface SeededMarketVectors {
  readonly availableResources: ResourceType[];
  readonly supplyVector: number[];
  readonly demandVector: number[];
}

/** Every planet trades the full resource catalogue; cross-planet spreads come
 *  from the economy-biased supply/demand vectors, not from which goods exist. */
const ALL_RESOURCES = Object.values(ResourceType) as ResourceType[];

/** Lower bound so every vector entry stays strictly positive — getPrice() and
 *  getMarketPrice() divide by supply, so a zero would blow up the price. */
const MIN_VECTOR = 0.1;

/** Per-planet jitter band: ±15% around the economy-baseline-derived value, so no
 *  two planets share identical vectors yet the bias direction never flips. */
const JITTER_LOW = 0.85;
const JITTER_SPAN = 0.3;

function defaultRng(planetId: string): () => number {
  const rng = new SeededRNG(`market:${planetId}`);
  return () => rng.next();
}

/**
 * Deterministically seed a planet's market with real `availableResources` plus
 * `supply`/`demand` vectors biased by its economy type, so the already-shipped
 * dynamic-pricing layer (drift, trade impact, events) finally has data to act on.
 *
 * Bias derives from {@link economyBaseline} so the dynamic vectors agree in
 * direction with the static `econMult` TradeSystem applies: a *cheap* baseline
 * (e.g. ORGANICS on an AGRICULTURAL world) yields abundant supply + low demand,
 * a *dear* baseline (e.g. ELECTRONICS there) yields scarce supply + high demand.
 * The result is stable cross-planet arbitrage spreads that make economic sense.
 *
 * Pure and deterministic: the same `planetId` always produces the same vectors
 * (seeded RNG, never `Math.random`), so saves and replays stay stable. Pass an
 * explicit `rng` (e.g. seeded from `galaxy.id + planetId`) to vary the seed.
 */
export function seedMarket(
  economyType: EconomyType,
  planetId: string,
  rng: () => number = defaultRng(planetId),
): SeededMarketVectors {
  const availableResources = [...ALL_RESOURCES];
  const supplyVector: number[] = [];
  const demandVector: number[] = [];

  for (const resource of availableResources) {
    const baseline = economyBaseline(economyType, resource);
    const supplyJitter = JITTER_LOW + rng() * JITTER_SPAN;
    const demandJitter = JITTER_LOW + rng() * JITTER_SPAN;
    // Inverse of the baseline ⇒ cheap goods are abundant (high supply, low
    // demand); dear goods are scarce (low supply, high demand).
    supplyVector.push(Math.max(MIN_VECTOR, (1 / baseline) * supplyJitter));
    demandVector.push(Math.max(MIN_VECTOR, baseline * demandJitter));
  }

  return { availableResources, supplyVector, demandVector };
}
