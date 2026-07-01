/**
 * Letsplay engine — pure helpers backing the Task 1 observation signals
 * (dev-only). Kept isolated from `observe.ts` so each signal is unit-testable
 * against plain data, without booting a `GameEngine`.
 */
import { StationType } from "@/types";
import { GearKind } from "@/systems/equipment/GearCatalog";
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
}

function cheapestOf(
  listings: GearListing[],
  hullsOnly: boolean,
): number | null {
  let min: number | null = null;
  for (const l of listings) {
    if (hullsOnly !== (l.gear.kind === GearKind.HULL)) continue;
    if (min === null || l.price < min) min = l.price;
  }
  return min;
}

/**
 * Cheapest non-hull gear price and cheapest hull price available in the
 * CURRENT system's shops — every planet fields a gear shop; hull trade-ins are
 * planet-only (mirrors `EquipmentShopScene`, which excludes hulls from station
 * shops). Deterministic (the same seeded {@link generateShop} the real shop
 * scenes use). Restricted to the current system only, same as the market: an
 * unvisited system's shop is never priced. `null` when the system fields no
 * shop at all (no planets, no stations).
 */
export function systemShopPrices(ctx: ShopPriceContext): {
  cheapestGearPrice: number | null;
  bestHullPrice: number | null;
} {
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
  return {
    cheapestGearPrice: cheapestOf(listings, false),
    bestHullPrice: cheapestOf(listings, true),
  };
}
