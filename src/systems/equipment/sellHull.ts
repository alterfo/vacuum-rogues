import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "./ShipLoadout";
import { gearById, type HullSpec } from "./GearCatalog";
import { slotToBagModule, applyLoadoutHullToShip } from "./GearBridge";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

/**
 * Hull trade-in (install/micromodule overhaul Task 7): a planet Верфь lets you
 * buy/install hulls but has no «Продать» action for the hull itself (that only
 * exists on the gear ТРЮМ strip, and hulls are excluded there). Buying a
 * replacement hull instead refunds a fraction of the **old** hull's value — a
 * trade-in, mirroring the `StationScene` swap modal. This module is the single
 * source of truth for both the trade-in price and the credit movement so the two
 * shop flows can't value a hull differently.
 */

/**
 * Trade-in rate for an old hull: 40 % of base price — the same factor the gear
 * sell/swap flow already refunds ({@link sellGearPrice}, the `StationScene`
 * trade-in modal), so a hull and a piece of gear value the same way.
 */
export const HULL_TRADE_IN_RATE = 0.4;

/**
 * Credits refunded for trading in a hull on replacement: `basePrice × 0.4`,
 * floored to a whole credit. Pure — depends only on the catalog hull, never on
 * player state. Whole-number (floored) so the projected current-account balance
 * never lands fractional.
 */
export function hullTradeInPrice(hull: HullSpec): number {
  return Math.floor(hull.basePrice * HULL_TRADE_IN_RATE);
}

export interface HullPurchaseResult {
  /** Credits refunded for trading in the previously-fitted hull (0 when unchanged). */
  tradeIn: number;
  /** Net signed credit change applied to the player: `tradeIn − price`. */
  netCharge: number;
  /** Id of the hull that was traded in. */
  oldHullId: string;
  /** Gear dropped because it no longer fits the new hull (re-bagged losslessly). */
  dropped: Array<{ gearId: string; micromoduleId?: string; upgrades?: number }>;
}

/**
 * Install a replacement hull at the Верфь with a trade-in of the old one. Two
 * balanced bus postings — charge the new hull's `price`, then credit the old
 * hull's {@link hullTradeInPrice} — so money has a real GL source/sink (АБС);
 * the net is the upgrade cost (`price − tradeIn`). The canonical
 * {@link ShipLoadout} is swapped (it returns gear that no longer fits a smaller
 * hull, which is re-bagged losslessly via {@link slotToBagModule} rather than
 * destroyed), then the new hull's HP pool + class label are projected onto the
 * live ship. The loadout always holds exactly one hull, so the player can never
 * end hull-less.
 *
 * `price` is the shop listing price (catalog `basePrice` plus the shop markup),
 * passed in because the markup lives in the shop, not the catalog. Trading in the
 * same hull (`newHull.id === loadout.hull.id`) refunds nothing.
 */
export function buyHullWithTradeIn(
  access: BankAccess | null | undefined,
  player: Player,
  loadout: ShipLoadout,
  newHull: HullSpec,
  price: number,
): HullPurchaseResult {
  const oldHull = loadout.hull;
  const tradeIn = oldHull.id === newHull.id ? 0 : hullTradeInPrice(oldHull);

  adjustPlayerCredits(
    access,
    player,
    -price,
    GL_COUNTERPARTY.EQUIPMENT,
    `Покупка: ${newHull.name}`,
  );
  if (tradeIn > 0) {
    adjustPlayerCredits(
      access,
      player,
      tradeIn,
      GL_COUNTERPARTY.EQUIPMENT,
      `Сдача корпуса: ${oldHull.name}`,
    );
  }

  const dropped = loadout.swapHull(newHull.id);
  for (const slot of dropped) {
    const g = gearById(slot.gearId);
    if (g) player.inventory.addItem(slotToBagModule(g, slot));
  }
  applyLoadoutHullToShip(player.ship, loadout);

  return {
    tradeIn,
    netCharge: tradeIn - price,
    oldHullId: oldHull.id,
    dropped,
  };
}
