/**
 * Letsplay engine — pure helpers backing the Task 1 observation signals
 * (dev-only). Kept isolated from `observe.ts` so each signal is unit-testable
 * against plain data, without booting a `GameEngine`.
 */
import { QuestType, StationType } from "@/types";
import type { ResourceType } from "@/types";
import { GearKind } from "@/systems/equipment/GearCatalog";
import type { HullSpec } from "@/systems/equipment/GearCatalog";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { BankingService } from "@/systems/banking/BankingService";
import { loanAccountId } from "@/systems/banking/products";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";

/** True when any station in the list is of the given type. */
export function hasStationOfType(
  stations: readonly { type: StationType }[],
  type: StationType,
): boolean {
  return stations.some((s) => s.type === type);
}

/**
 * Bank access at the current location: a landed planet always offers one
 * (every `PlanetScene` shows a Банк button unconditionally); off-planet it is
 * limited to the station types that field it, mirroring `StationScene`'s
 * `TYPE_SERVICES` bank list (TRADE_POST, MILITARY_BASE).
 */
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

/**
 * True when the current system either *is* the Overmind core system or has a
 * direct warp connection to it (the graph is read as given — one warp hop
 * away, not undirected — since this is a "can I get there next jump" signal
 * from the player's actual position).
 */
export function isNearOvermindCore(
  system: { id: string; connections: readonly { toSystemId: string }[] } | null,
  overmindCoreSystemId: string,
): boolean {
  if (!system || !overmindCoreSystemId) return false;
  if (system.id === overmindCoreSystemId) return true;
  return system.connections.some((c) => c.toSystemId === overmindCoreSystemId);
}

/** Fraction (0..1) of the galaxy's systems currently Overmind-controlled. */
export function overmindShareOf(
  overmindSystemCount: number,
  totalSystemCount: number,
): number {
  if (totalSystemCount <= 0) return 0;
  return overmindSystemCount / totalSystemCount;
}

/** True when a carried quest's delivery system is the player's current system. */
export function isQuestDeliveryHere(
  quests: readonly { targetSystemId: string | null }[],
  currentSystemId: string,
): boolean {
  return quests.some((q) => q.targetSystemId === currentSystemId);
}

/** One DELIVERY quest's unmet COLLECT_ITEM need — the structural slice of `QuestSnapshot` this reads. */
export interface QuestCargoNeed {
  readonly type: QuestType;
  readonly rewardCredits?: number;
  readonly collectItem?: {
    readonly type: ResourceType;
    readonly required: number;
    readonly carried: number;
  } | null;
}

/**
 * The best DELIVERY-quest cargo purchase actionable RIGHT HERE: an active
 * DELIVERY quest's unmet COLLECT_ITEM good, stocked on the current market,
 * whose full remaining need still costs strictly less than the quest's own
 * (already-known, contractual) reward. Never a speculative buy — the payout
 * is a known number, not a price guess — and capped to exactly what the
 * quest still needs, never the whole wallet. `null` when no active DELIVERY
 * quest has an affordable, profitable, stocked-here need.
 */
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

/** A DELIVERY quest ready to turn in, plus where to take the cargo. */
export interface QuestDeliveryReady {
  readonly good: ResourceType;
  readonly targetSystemId: string | null;
  readonly targetPlanetId: string | null;
}

/**
 * An active DELIVERY quest whose COLLECT_ITEM need is now fully met —
 * cargo held for it is committed to the quest, not a market good to sell, and
 * the ship should route to the quest's own target rather than a remembered
 * sell planet. `null` when no carried DELIVERY quest is ready to turn in.
 */
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

/** The player's outstanding-loan status, read off the bank's ledger + arrears state. */
export interface LoanStatus {
  readonly active: boolean;
  /** Outstanding balance owed (positive), 0 when there is no active loan. */
  readonly balance: number;
  /** Consecutive missed scheduled payments, 0 when there is no active loan. */
  readonly missedPayments: number;
}

/** No-account / no-debt default, shared by every early return below. */
const NO_LOAN: LoanStatus = { active: false, balance: 0, missedPayments: 0 };

/**
 * Resolve `playerId`'s current loan status. A loan is "active" once its ledger
 * balance owes more than a rounding epsilon; the missed-payment count comes
 * from the bank's tracked arrears state (absent ⇒ never missed one yet).
 */
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

/** The system context {@link systemShopPrices} needs — ids only, no PixiJS. */
export interface ShopPriceContext {
  readonly seed: string;
  readonly day: number;
  readonly system: {
    readonly id: string;
    readonly techLevel: number;
    readonly planets: readonly { readonly id: string }[];
    readonly stations: readonly { readonly id: string }[];
  };
  /**
   * HP of the currently-fitted hull. `bestHullPrice` counts only hulls that are
   * a genuine upgrade over this (hp strictly greater), matching what
   * `bestAffordableHull`/`executeUpgradeHull` will actually buy — otherwise the
   * `upgrade-hull` gate fires on a hull the executor refuses to install,
   * soft-locking the autopilot in a no-op STATION loop. Absent ⇒ `0` (count all).
   */
  readonly fittedHullHp?: number;
  /**
   * Trade-in credits the fitted hull refunds on a replacement — subtracted from
   * every candidate hull's gross listing so `bestHullPrice` is the NET wallet
   * cost, matching the shop UI (`EquipmentShopScene.buyHull` gates on
   * `credits < price − tradeIn`) and `bestAffordableHull`. Without it the
   * `upgrade-hull` legality gate (`credits >= bestHullPrice`) demanded the gross
   * price, pruning a hull a real player at the same wallet could afford — the
   * gap that stalled the campaign agent one upgrade short of a battle-ready hull.
   * Absent ⇒ `0` (gross, the legacy signal for fixtures that don't thread it).
   */
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
    // A hull that isn't strictly better than the fitted one is never a real
    // upgrade — skip it so the affordability signal can't outrun the executor.
    if (isHull && (l.gear as HullSpec).hp <= minHullHp) continue;
    // Hulls price at their NET cost (gross − fitted-hull trade-in) so the
    // affordability signal matches what the wallet actually pays.
    const price = isHull ? Math.max(0, l.price - hullTradeIn) : l.price;
    if (min === null || price < min) min = price;
  }
  return min;
}

/**
 * Every gear listing stocked across `ctx.system`'s shops: planets stock the
 * full catalog (incl. hulls); off-planet stations exclude hulls (mirrors
 * `EquipmentShopScene`, which excludes hulls from station shops). Deterministic
 * (the same seeded {@link generateShop} the real shop scenes use). The single
 * source of truth for "what's for sale in this system" — shared by
 * {@link systemShopPrices} (affordability signals) and `equipmentQueries.ts`
 * (what the applier actually buys) so the two can never price the world
 * differently.
 */
export function generateSystemListings(ctx: ShopPriceContext): GearListing[] {
  const listings: GearListing[] = [];
  for (const planet of ctx.system.planets) {
    listings.push(
      ...generateShop({
        systemId: ctx.system.id,
        planetId: planet.id,
        seed: ctx.seed,
        day: ctx.day,
        maxTechLevel: ctx.system.techLevel,
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
        maxTechLevel: ctx.system.techLevel,
      }).filter((l) => l.gear.kind !== GearKind.HULL),
    );
  }
  return listings;
}

/**
 * Cheapest non-hull gear price and cheapest hull price available in the
 * CURRENT system's shops. Restricted to the current system only, same as the
 * market: an unvisited system's shop is never priced. `null` when the system
 * fields no shop at all (no planets, no stations).
 */
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
