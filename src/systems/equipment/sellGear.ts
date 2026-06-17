import type { Player } from "@/domain/Player";
import { gearById, type Gear } from "./GearCatalog";

/**
 * Trade-in rate for selling gear: 40 % of base price — the same factor the
 * hull/gear swap flow already refunds (`StationScene` trade-in modal), so a sell
 * and a swap value the same item identically.
 */
export const SELL_RATE = 0.4;

/**
 * Credits refunded when selling a piece of gear: `basePrice × 0.4`, floored to a
 * whole credit. Pure — depends only on the catalog item, never on player state.
 */
export function sellGearPrice(gear: Gear): number {
  return Math.floor(gear.basePrice * SELL_RATE);
}

/**
 * Sell one owned-but-uninstalled gear copy: drop its id from the canonical owned
 * store (`Inventory.ownedGearIds`) and refund {@link sellGearPrice} into the
 * player's credits. Returns the credits refunded, or `0` when nothing was sold.
 *
 * Returns `0` (and changes nothing) for an unknown gear id or for an id that is
 * not in the owned store. Installed gear lives in the `ShipLoadout`, never the
 * owned store, so it can never be sold through here — the player must unequip it
 * first. This is the single seam both the hangar and equipment-shop ТРЮМ views
 * call, so the sell rule can't diverge between scenes.
 */
export function sellUninstalledGear(player: Player, gearId: string): number {
  const gear = gearById(gearId);
  if (!gear) return 0;
  if (!player.inventory.removeOwnedGear(gearId)) return 0;
  const refund = sellGearPrice(gear);
  player.credits += refund;
  return refund;
}
