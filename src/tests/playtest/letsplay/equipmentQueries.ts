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
import {
  buyHullWithTradeIn,
  hullTradeInPrice,
} from "@/systems/equipment/sellHull";
import { sellUninstalledGear } from "@/systems/equipment/sellGear";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem, runInHangarPanel } from "./engineQueries";
import { generateSystemListings } from "./observeHelpers";

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

export function bestAffordableHull(engine: GameEngine): GearListing | null {
  const credits = engine.player?.credits ?? 0;
  const loadout = engine.playerLoadout;
  const fittedHp = loadout?.hull.hp ?? 0;
  const tradeIn = loadout ? hullTradeInPrice(loadout.hull) : 0;
  let best: GearListing | null = null;
  for (const listing of systemListings(engine)) {
    if (listing.gear.kind !== GearKind.HULL) continue;
    if ((listing.gear as HullSpec).hp <= fittedHp) continue;
    const netPrice = Math.max(0, listing.price - tradeIn);
    if (netPrice > credits) continue;
    if (!best || listing.price > best.price) best = listing;
  }
  return best;
}

export function hullUpgradeNetCost(engine: GameEngine): number | null {
  const listing = bestAffordableHull(engine);
  if (!listing) return null;
  const loadout = engine.playerLoadout;
  const tradeIn = loadout ? hullTradeInPrice(loadout.hull) : 0;
  return Math.max(0, listing.price - tradeIn);
}

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

export function executeBuyBestGear(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const listing = bestAffordableGear(engine);
  if (!listing) return;
  runInHangarPanel(engine, () => {
    adjustPlayerCredits(
      engine.bank,
      player,
      -listing.price,
      GL_COUNTERPARTY.EQUIPMENT,
      `Покупка: ${listing.gear.name}`,
    );
    acquireUninstalledGear(player, listing.gear.id);
  });
}

export function executeUpgradeHull(engine: GameEngine): void {
  const player = engine.player;
  const loadout = engine.playerLoadout;
  if (!player || !loadout) return;
  const listing = bestAffordableHull(engine);
  if (!listing) return;
  const hull = listing.gear as HullSpec;
  if (hull.id === loadout.hull.id) return;
  runInHangarPanel(engine, () => {
    buyHullWithTradeIn(engine.bank, player, loadout, hull, listing.price);
  });
}

export function executeBuyBestModule(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const mm = cheapestMicromodule(engine);
  if (!mm) return;
  runInHangarPanel(engine, () => {
    buyMicromodule(engine.bank, player, mm);
  });
}

function weaponBaseDamage(gearId: string): number {
  const g = gearById(gearId);
  return g && g.kind === GearKind.WEAPON ? (g as WeaponSpec).damage : 0;
}

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

export interface ArmUpPlan {
  buyId?: string;
  buyPrice?: number;
  installId: string;
  uninstallIndex?: number;
}

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
  candidates.sort(
    (a, b) => b.damage - a.damage || (a.buyPrice ?? -1) - (b.buyPrice ?? -1),
  );
  const asPlan = (c: (typeof candidates)[number], uninstallIndex?: number) =>
    c.buyPrice === undefined
      ? { installId: c.id, uninstallIndex }
      : { buyId: c.id, buyPrice: c.buyPrice, installId: c.id, uninstallIndex };

  const weapons = loadout.derivedStats().categories.weapon;
  if (weapons.used < weapons.total) {
    for (const c of candidates) {
      if (gearFit(loadout, c.id).status === "fits") return asPlan(c);
    }
  }

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

export function canArmUp(engine: GameEngine): boolean {
  return planArmUp(engine) != null;
}

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
    const displacedId = loadout.installedSlots()[plan.uninstallIndex]?.gearId;
    uninstallToOwned(player, loadout, plan.uninstallIndex);
    if (displacedId != null && displacedId !== plan.installId) {
      sellUninstalledGear(player, displacedId, engine.bank);
    }
  }
  installOwnedGear(player, loadout, plan.installId);
}
