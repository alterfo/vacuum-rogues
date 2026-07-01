/**
 * Letsplay engine — equipment-shop query + purchase helpers (dev-only).
 *
 * The pure finders scan the player's current system via the shared
 * {@link generateSystemListings} (`observeHelpers.ts`) — the same call backing
 * the `cheapestGearPrice`/`bestHullPrice` observation signals, so "what's
 * affordable" (what gates the `buy-gear`/`upgrade-hull` legal actions) and "what
 * the applier actually buys" can never diverge. The executors move real credits
 * + gear through the canonical `GearBridge`/`sellHull`/`micromoduleShop` seams
 * (never a direct field mutation), bypassing the shop UI exactly as
 * `executeTradeOnPlanet` (`engineQueries.ts`) bypasses `TradeScene`.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module.
 */
import type { GameEngine } from "@/systems/GameEngine";
import type { MicroModule } from "@/types";
import { GearKind, type HullSpec } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  micromoduleShopCatalog,
  micromodulePrice,
  playerOwnsMicromodule,
  buyMicromodule,
} from "@/systems/equipment/micromoduleShop";
import { acquireUninstalledGear } from "@/systems/equipment/GearBridge";
import { buyHullWithTradeIn } from "@/systems/equipment/sellHull";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem } from "./engineQueries";
import { generateSystemListings } from "./observeHelpers";

/**
 * Every gear listing stocked in the player's current system, via the shared
 * {@link generateSystemListings}. Empty with no system/galaxy.
 */
function systemListings(engine: GameEngine): GearListing[] {
  const sys = currentSystem(engine);
  const galaxy = engine.galaxy;
  if (!sys || !galaxy) return [];
  return generateSystemListings({
    seed: galaxy.id,
    day: galaxy.gameDays,
    system: sys,
  });
}

/**
 * The priciest affordable non-hull gear stocked in-system — a genuine upgrade
 * over the cheapest filler, capped at what the player can pay right now. `null`
 * when nothing affordable is stocked.
 */
export function bestAffordableGear(engine: GameEngine): GearListing | null {
  const credits = engine.player?.credits ?? 0;
  let best: GearListing | null = null;
  for (const listing of systemListings(engine)) {
    if (listing.gear.kind === GearKind.HULL) continue;
    if (listing.price > credits) continue;
    if (!best || listing.price > best.price) best = listing;
  }
  return best;
}

/** The priciest affordable hull stocked in-system (hulls are planet-only). `null` if none. */
export function bestAffordableHull(engine: GameEngine): GearListing | null {
  const credits = engine.player?.credits ?? 0;
  let best: GearListing | null = null;
  for (const listing of systemListings(engine)) {
    if (listing.gear.kind !== GearKind.HULL) continue;
    if (listing.price > credits) continue;
    if (!best || listing.price > best.price) best = listing;
  }
  return best;
}

/** The cheapest not-yet-owned micromodule the player can currently afford. `null` if none. */
export function cheapestMicromodule(engine: GameEngine): MicroModule | null {
  const player = engine.player;
  if (!player) return null;
  let best: MicroModule | null = null;
  let bestPrice = Infinity;
  for (const mm of micromoduleShopCatalog()) {
    if (playerOwnsMicromodule(player, mm.id)) continue;
    const price = micromodulePrice(mm);
    if (price > player.credits || price >= bestPrice) continue;
    bestPrice = price;
    best = mm;
  }
  return best;
}

/**
 * Buy the priciest affordable non-hull gear in-system into the owned-uninstalled
 * store (never auto-installed — mirrors both the station shop and the planet
 * Верфь gear tab). A real player→equipment GL transfer. A no-op when nothing
 * affordable is stocked.
 */
export function executeBuyBestGear(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const listing = bestAffordableGear(engine);
  if (!listing) return;
  adjustPlayerCredits(
    engine.bank,
    player,
    -listing.price,
    GL_COUNTERPARTY.EQUIPMENT,
    `Покупка: ${listing.gear.name}`,
  );
  acquireUninstalledGear(player, listing.gear.id);
}

/**
 * Trade in the current hull for the priciest affordable one in-system through the
 * canonical {@link buyHullWithTradeIn} seam. A no-op when nothing affordable is
 * stocked or the best available is already fitted.
 */
export function executeUpgradeHull(engine: GameEngine): void {
  const player = engine.player;
  const loadout = engine.playerLoadout;
  if (!player || !loadout) return;
  const listing = bestAffordableHull(engine);
  if (!listing) return;
  const hull = listing.gear as HullSpec;
  if (hull.id === loadout.hull.id) return;
  buyHullWithTradeIn(engine.bank, player, loadout, hull, listing.price);
}

/**
 * Buy the cheapest affordable not-yet-owned micromodule through the canonical
 * {@link buyMicromodule} seam. A no-op when none is affordable/unowned.
 */
export function executeBuyBestModule(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const mm = cheapestMicromodule(engine);
  if (!mm) return;
  buyMicromodule(engine.bank, player, mm);
}
