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
import {
  GearKind,
  gearById,
  type HullSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  micromoduleShopCatalog,
  micromodulePrice,
  playerOwnsMicromodule,
  buyMicromodule,
} from "@/systems/equipment/micromoduleShop";
import {
  acquireUninstalledGear,
  installOwnedGear,
  uninstallToOwned,
  ownedUninstalledGear,
  gearFit,
} from "@/systems/equipment/GearBridge";
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

/**
 * The priciest affordable hull stocked in-system that is a genuine upgrade over
 * the currently-fitted hull (hulls are planet-only). Candidates with `hp` at or
 * below the fitted hull's are skipped — buying one would trade the ship down for
 * a weaker hull at a net credit cost (the trade-in never refunds the full price),
 * so "upgrade-hull" must never make the ship worse. `null` if none qualifies.
 */
export function bestAffordableHull(engine: GameEngine): GearListing | null {
  const credits = engine.player?.credits ?? 0;
  const fittedHp = engine.playerLoadout?.hull.hp ?? 0;
  let best: GearListing | null = null;
  for (const listing of systemListings(engine)) {
    if (listing.gear.kind !== GearKind.HULL) continue;
    if (listing.price > credits) continue;
    if ((listing.gear as HullSpec).hp <= fittedHp) continue;
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

/** Base damage of a gear id (0 for anything that isn't a weapon / unknown). */
function weaponBaseDamage(gearId: string): number {
  const g = gearById(gearId);
  return g && g.kind === GearKind.WEAPON ? (g as WeaponSpec).damage : 0;
}

/**
 * The strongest affordable weapon stocked in-system — the best gun the player
 * can buy right now, ranked by raw {@link WeaponSpec.damage} (not price, unlike
 * {@link bestAffordableGear}: military progression wants firepower, not the
 * priciest filler). `null` when none is affordable/stocked.
 */
export function bestAffordableWeapon(engine: GameEngine): GearListing | null {
  const credits = engine.player?.credits ?? 0;
  let best: GearListing | null = null;
  for (const listing of systemListings(engine)) {
    if (listing.gear.kind !== GearKind.WEAPON) continue;
    if (listing.price > credits) continue;
    if (
      !best ||
      (listing.gear as WeaponSpec).damage > (best.gear as WeaponSpec).damage
    ) {
      best = listing;
    }
  }
  return best;
}

/** A single "get better armed" move: which gun to field and how (buy/swap). */
export interface ArmUpPlan {
  /** Weapon to purchase first (its listed price), when the pick isn't owned yet. */
  buyId?: string;
  buyPrice?: number;
  /** Weapon id to install into the loadout (owned after any buy above). */
  installId: string;
  /** Installed-slot index to free first when the weapon bank is full. */
  uninstallIndex?: number;
}

/**
 * Decide the single best move that raises **installed** weapon damage: field the
 * strongest gun the player can access — one already owned-uninstalled, or the
 * strongest affordable one stocked in-system — into a free weapon slot, or swap
 * it in for the weakest installed weapon when the bank is full. `null` when no
 * improvement is possible (already carrying the best fittable guns, or nothing
 * to buy/install). Pure — never mutates; {@link canArmUp}/{@link executeArmUp}
 * share it so legality can never diverge from what the executor actually does.
 */
export function planArmUp(engine: GameEngine): ArmUpPlan | null {
  const player = engine.player;
  const loadout = engine.playerLoadout;
  if (!player || !loadout) return null;

  const candidates: { id: string; damage: number; buyPrice?: number }[] = [];
  for (const id of ownedUninstalledGear(player, loadout)) {
    const damage = weaponBaseDamage(id);
    if (damage > 0) candidates.push({ id, damage });
  }
  const forSale = bestAffordableWeapon(engine);
  if (forSale) {
    candidates.push({
      id: forSale.gear.id,
      damage: (forSale.gear as WeaponSpec).damage,
      buyPrice: forSale.price,
    });
  }
  if (candidates.length === 0) return null;
  // Strongest first; on a damage tie prefer an already-owned copy (costs nothing
  // to field) over one that must be bought.
  candidates.sort(
    (a, b) => b.damage - a.damage || (a.buyPrice ?? -1) - (b.buyPrice ?? -1),
  );
  const asPlan = (c: (typeof candidates)[number], uninstallIndex?: number) =>
    c.buyPrice === undefined
      ? { installId: c.id, uninstallIndex }
      : { buyId: c.id, buyPrice: c.buyPrice, installId: c.id, uninstallIndex };

  // A free weapon slot: install the strongest candidate that fits (slot + mass).
  // `gearFit` reads the loadout's live capacity, so it answers for a buyable id
  // just as well as an owned one.
  const weapons = loadout.derivedStats().categories.weapon;
  if (weapons.used < weapons.total) {
    for (const c of candidates) {
      if (gearFit(loadout, c.id).status === "fits") return asPlan(c);
    }
  }

  // Bank full (or nothing fit a free slot on mass): swap the strongest candidate
  // in for the weakest installed weapon — only when it's a genuine damage
  // upgrade and fits once that weapon's mass is freed.
  const installed = loadout
    .installedSlots()
    .map((s, index) => ({
      index,
      damage: weaponBaseDamage(s.gearId),
      id: s.gearId,
    }))
    .filter((w) => w.damage > 0);
  if (installed.length === 0) return null;
  const weakest = installed.reduce((min, w) =>
    w.damage < min.damage ? w : min,
  );
  const stats = loadout.derivedStats();
  const freedMass = gearById(weakest.id)?.mass ?? 0;
  for (const c of candidates) {
    if (c.damage <= weakest.damage) break; // sorted desc → nothing stronger left
    const mass = gearById(c.id)?.mass ?? 0;
    if (mass > stats.massFree + freedMass) continue; // wouldn't fit after the swap
    return asPlan(c, weakest.index);
  }
  return null;
}

/** Whether {@link executeArmUp} would raise installed weapon damage right now. */
export function canArmUp(engine: GameEngine): boolean {
  return planArmUp(engine) != null;
}

/**
 * Get the ship better armed: buy the strongest affordable in-system gun when it
 * beats what the player already has, then install the strongest owned weapon
 * (swapping out the weakest fitted one if every weapon slot is full). Routes
 * every credit + gear move through the canonical banking / {@link GearBridge}
 * seams. A safe no-op when no weapon improvement is possible.
 */
export function executeArmUp(engine: GameEngine): void {
  const player = engine.player;
  const loadout = engine.playerLoadout;
  if (!player || !loadout) return;
  const plan = planArmUp(engine);
  if (!plan) return;
  if (plan.buyId != null && plan.buyPrice != null) {
    adjustPlayerCredits(
      engine.bank,
      player,
      -plan.buyPrice,
      GL_COUNTERPARTY.EQUIPMENT,
      `Покупка: ${gearById(plan.buyId)?.name ?? plan.buyId}`,
    );
    acquireUninstalledGear(player, plan.buyId);
  }
  if (plan.uninstallIndex != null) {
    uninstallToOwned(player, loadout, plan.uninstallIndex);
  }
  installOwnedGear(player, loadout, plan.installId);
}
