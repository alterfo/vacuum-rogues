import type { EconomyType } from "@/types";
import { ResourceType } from "@/types";
import { economyBaseline } from "@/domain/Market";
import { SeededRNG } from "@/utils/seededRNG";

export interface SeededMarketVectors {
  readonly availableResources: ResourceType[];
  readonly supplyVector: number[];
  readonly demandVector: number[];
}

const ALL_RESOURCES = Object.values(ResourceType) as ResourceType[];

const MIN_VECTOR = 0.1;

const JITTER_LOW = 0.85;
const JITTER_SPAN = 0.3;

export function seedMarket(
  economyType: EconomyType,
  planetId: string,
): SeededMarketVectors {
  const rng = new SeededRNG(`market:${planetId}`);
  const availableResources = [...ALL_RESOURCES];
  const supplyVector: number[] = [];
  const demandVector: number[] = [];

  for (const resource of availableResources) {
    const baseline = economyBaseline(economyType, resource);
    const supplyJitter = JITTER_LOW + rng.next() * JITTER_SPAN;
    const demandJitter = JITTER_LOW + rng.next() * JITTER_SPAN;
    supplyVector.push(Math.max(MIN_VECTOR, (1 / baseline) * supplyJitter));
    demandVector.push(Math.max(MIN_VECTOR, baseline * demandJitter));
  }

  return { availableResources, supplyVector, demandVector };
}
