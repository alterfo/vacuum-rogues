import { QuestType, StationType } from "@/types";
import type { ResourceType } from "@/types";
import { GearKind } from "@/systems/equipment/GearCatalog";
import type { HullSpec } from "@/systems/equipment/GearCatalog";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { BankingService } from "@/systems/banking/BankingService";
import { loanAccountId } from "@/systems/banking/products";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";

export function hasStationOfType(
  stations: readonly { type: StationType }[],
  type: StationType,
): boolean {
  return stations.some((s) => s.type === type);
}

export function hasBankAccess(
  landed: boolean,
  stations: readonly { type: StationType }[],
): boolean {
  if (landed) return true;
  return stations.some(
    (s) =>
      s.type === StationType.TRADE_POST || s.type === StationType.MILITARY_BASE,
  );
}

export function isNearOvermindCore(
  system: { id: string; connections: readonly { toSystemId: string }[] } | null,
  overmindCoreSystemId: string,
): boolean {
  if (!system || !overmindCoreSystemId) return false;
  if (system.id === overmindCoreSystemId) return true;
  return system.connections.some((c) => c.toSystemId === overmindCoreSystemId);
}

export function overmindShareOf(
  overmindSystemCount: number,
  totalSystemCount: number,
): number {
  if (totalSystemCount <= 0) return 0;
  return overmindSystemCount / totalSystemCount;
}

export function isQuestDeliveryHere(
  quests: readonly { targetSystemId: string | null }[],
  currentSystemId: string,
): boolean {
  return quests.some((q) => q.targetSystemId === currentSystemId);
}

export interface QuestCargoNeed {
  readonly type: QuestType;
  readonly rewardCredits?: number;
  readonly collectItem?: {
    readonly type: ResourceType;
    readonly required: number;
    readonly carried: number;
  } | null;
}

export function deliveryCargoNeed(
  quests: readonly QuestCargoNeed[],
  market: readonly { resource: ResourceType; buy: number }[] | undefined,
): { good: ResourceType; qty: number } | null {
  for (const q of quests) {
    if (q.type !== QuestType.DELIVERY || !q.collectItem) continue;
    const need = q.collectItem.required - q.collectItem.carried;
    if (need <= 0) continue;
    const listing = market?.find((m) => m.resource === q.collectItem!.type);
    if (!listing || listing.buy <= 0) continue;
    const reward = q.rewardCredits ?? 0;
    if (listing.buy * need >= reward) continue;
    return { good: q.collectItem.type, qty: need };
  }
  return null;
}

export interface QuestDeliveryReady {
  readonly good: ResourceType;
  readonly targetSystemId: string | null;
  readonly targetPlanetId: string | null;
}

export function deliveryReadyToTurnIn(
  quests: readonly (QuestCargoNeed & {
    targetSystemId?: string | null;
    targetPlanetId?: string | null;
  })[],
): QuestDeliveryReady | null {
  for (const q of quests) {
    if (q.type !== QuestType.DELIVERY || !q.collectItem) continue;
    if (q.collectItem.carried < q.collectItem.required) continue;
    return {
      good: q.collectItem.type,
      targetSystemId: q.targetSystemId ?? null,
      targetPlanetId: q.targetPlanetId ?? null,
    };
  }
  return null;
}

export interface LoanStatus {
  readonly active: boolean;
  readonly balance: number;
  readonly missedPayments: number;
}

const NO_LOAN: LoanStatus = { active: false, balance: 0, missedPayments: 0 };

export function loanStatusOf(
  bankingService: BankingService,
  playerId: string,
): LoanStatus {
  const id = loanAccountId(playerId);
  const ledger = bankingService.getLedger();
  if (!ledger.hasAccount(id)) return NO_LOAN;
  const balance = -ledger.balanceOf(id);
  if (balance <= BALANCE_EPSILON) return NO_LOAN;
  const missedPayments =
    bankingService.loanDefaultStateOf(id)?.missedPayments ?? 0;
  return { active: true, balance, missedPayments };
}

export interface ShopPriceContext {
  readonly seed: string;
  readonly day: number;
  readonly system: {
    readonly id: string;
    readonly techLevel: number;
    readonly planets: readonly { readonly id: string }[];
    readonly stations: readonly { readonly id: string }[];
  };
  readonly fittedHullHp?: number;
  readonly fittedHullTradeIn?: number;
}

function cheapestOf(
  listings: GearListing[],
  hullsOnly: boolean,
  minHullHp = 0,
  hullTradeIn = 0,
): number | null {
  let min: number | null = null;
  for (const l of listings) {
    const isHull = l.gear.kind === GearKind.HULL;
    if (hullsOnly !== isHull) continue;
    if (isHull && (l.gear as HullSpec).hp <= minHullHp) continue;
    const price = isHull ? Math.max(0, l.price - hullTradeIn) : l.price;
    if (min === null || price < min) min = price;
  }
  return min;
}

export function generateSystemListings(ctx: ShopPriceContext): GearListing[] {
  const maxTechLevel = techLevelWithUplift(ctx.system.techLevel, ctx.day);
  const listings: GearListing[] = [];
  for (const planet of ctx.system.planets) {
    listings.push(
      ...generateShop({
        systemId: ctx.system.id,
        planetId: planet.id,
        seed: ctx.seed,
        day: ctx.day,
        maxTechLevel,
      }),
    );
  }
  for (const station of ctx.system.stations) {
    listings.push(
      ...generateShop({
        systemId: ctx.system.id,
        planetId: station.id,
        seed: ctx.seed,
        day: ctx.day,
        maxTechLevel,
      }).filter((l) => l.gear.kind !== GearKind.HULL),
    );
  }
  return listings;
}

export function systemShopPrices(ctx: ShopPriceContext): {
  cheapestGearPrice: number | null;
  bestHullPrice: number | null;
} {
  const listings = generateSystemListings(ctx);
  return {
    cheapestGearPrice: cheapestOf(listings, false),
    bestHullPrice: cheapestOf(
      listings,
      true,
      ctx.fittedHullHp ?? 0,
      ctx.fittedHullTradeIn ?? 0,
    ),
  };
}
