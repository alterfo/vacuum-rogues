import type { Player } from "@/domain/Player";
import type { MicroModule } from "@/types";
import { MICRO_MODULES, HULL_MICRO_MODULES } from "./GearCatalog";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

/**
 * Micromodule shop (install/micromodule overhaul Task 5): CRAFT_CENTER (science)
 * stations sell micromodules. This is the single source of truth for *what* is
 * stocked and *how much* it costs, so the StationScene shop UI and the unit tests
 * share one purchase path (a balanced player→equipment GL transfer through the
 * banking bus).
 */

/**
 * Price of a micromodule, keyed by tier (tier 1 is the strongest bonus, so the
 * most expensive). Index 0 is unused — tiers are 1..3.
 */
export const MICROMODULE_TIER_PRICE = [0, 3200, 1800, 800] as const;

/** Credit cost of one micromodule at a science station. */
export function micromodulePrice(mm: MicroModule): number {
  return MICROMODULE_TIER_PRICE[mm.bonusTier];
}

/**
 * The full set a CRAFT_CENTER stocks: the 12 gear micromodules
 * ({@link MICRO_MODULES}) plus the hull-micromodule family
 * ({@link HULL_MICRO_MODULES} — defense / cargo / energy-redirect), which are sold
 * at science stations alongside them.
 */
export function micromoduleShopCatalog(): MicroModule[] {
  return [...MICRO_MODULES, ...HULL_MICRO_MODULES];
}

/** Whether the player already owns a micromodule with this id. */
export function playerOwnsMicromodule(player: Player, id: string): boolean {
  return player.inventory.micromodules.some((m) => m.id === id);
}

export type BuyMicromoduleResult =
  | { ok: true; price: number }
  | { ok: false; reason: "already-owned" | "insufficient-credits" };

/**
 * Buy a micromodule at a science station. Posts a balanced player→equipment GL
 * transfer through the banking bus ({@link adjustPlayerCredits}), then the module
 * lands in the player's owned micromodule inventory. Rejects an already-owned id
 * or an unaffordable price without moving any money or touching inventory.
 */
export function buyMicromodule(
  access: BankAccess | null | undefined,
  player: Player,
  mm: MicroModule,
): BuyMicromoduleResult {
  if (playerOwnsMicromodule(player, mm.id)) {
    return { ok: false, reason: "already-owned" };
  }
  const price = micromodulePrice(mm);
  if (player.credits < price) {
    return { ok: false, reason: "insufficient-credits" };
  }
  adjustPlayerCredits(
    access,
    player,
    -price,
    GL_COUNTERPARTY.EQUIPMENT,
    `Покупка: ${mm.name}`,
  );
  player.inventory.micromodules.push(mm);
  return { ok: true, price };
}
