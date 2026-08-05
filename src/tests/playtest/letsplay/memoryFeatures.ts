import type { ResourceType } from "@/types";
import { QuestType } from "@/types";
import type { Observation } from "./observe";
import type { AgentMemory, KnownOffer } from "./AgentMemory";
import { createMemory } from "./AgentMemory";

export const MEMORY_FEATURE_LENGTH = 20;

const CREDIT_SCALE = 10_000;
const DANGER_SCALE = 8;
const LOAN_SCALE = 100_000;
const MISSED_PAYMENTS_SCALE = 5;
const CARGO_VALUE_SCALE = 50_000;
const STAGNATION_DAYS_SCALE = 30;
const OVERMIND_DAYS_SCALE = 100;
const TOTAL_SYSTEMS_SCALE = 30;
const EQUIP_QUALITY_SCALE = 600;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface BestMargin {
  good: ResourceType | null;
  buyPlanet: string | null;
  sellPlanet: string | null;
  margin: number;
  fraction: number;
}

const NO_MARGIN: BestMargin = {
  good: null,
  buyPlanet: null,
  sellPlanet: null,
  margin: 0,
  fraction: 0,
};

export function bestKnownMargin(
  mem: AgentMemory,
  goodFilter?: (good: ResourceType) => boolean,
): BestMargin {
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
    if (goodFilter && !goodFilter(good)) continue;
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

export function profitIfSoldHere(obs: Observation, mem: AgentMemory): number {
  const market = obs.currentPlanet?.market;
  if (!market || mem.inventoryLots.length === 0) return 0;
  const sellOf = new Map<ResourceType, number>();
  for (const g of market) sellOf.set(g.resource, g.sell);
  const questCommittedGoods = new Set(
    obs.quests
      .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
      .map((q) => q.collectItem!.type),
  );

  let profit = 0;
  for (const lot of mem.inventoryLots) {
    if (questCommittedGoods.has(lot.good)) continue;
    const sell = sellOf.get(lot.good);
    if (sell === undefined) continue;
    const gain = (sell - lot.buyPrice) * lot.qty;
    if (gain > 0) profit += gain;
  }
  return profit;
}

export function cheapestKnownOffer(mem: AgentMemory): KnownOffer | null {
  let best: KnownOffer | null = null;
  for (const o of mem.knownOffers) {
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

export function goalSystemId(obs: Observation): string | null {
  const quest = obs.quests.find((q) => q.targetSystemId);
  if (quest?.targetSystemId) return quest.targetSystemId;
  return obs.player?.systemId ?? obs.system?.id ?? null;
}

export function routeDangerToGoal(obs: Observation, mem: AgentMemory): number {
  const goal = goalSystemId(obs);
  if (!goal) return 0;
  return mem.threatMap.get(goal) ?? 0;
}

export function worstKnownThreat(mem: AgentMemory): number {
  let worst = 0;
  for (const v of mem.threatMap.values()) if (v > worst) worst = v;
  return worst;
}

function bestKnownSellPrice(mem: AgentMemory, good: ResourceType): number {
  let best = 0;
  for (const goods of mem.priceBook.values()) {
    const rec = goods.get(good);
    if (rec && rec.sell > best) best = rec.sell;
  }
  return best;
}

export function estimatedCargoValue(mem: AgentMemory): number {
  let value = 0;
  for (const lot of mem.inventoryLots) {
    const known = bestKnownSellPrice(mem, lot.good);
    value += (known > 0 ? known : lot.buyPrice) * lot.qty;
  }
  return value;
}

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
  const repRangerFraction = clamp01(mem.lastReputationBastions / 100);
  const repPirateFraction = clamp01(mem.lastReputationSyndicate / 100);
  const overmindDaysPressure = clamp01(
    mem.overmindDaysSeen / OVERMIND_DAYS_SCALE,
  );
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
