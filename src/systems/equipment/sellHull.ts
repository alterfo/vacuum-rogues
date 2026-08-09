import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "./ShipLoadout";
import { gearById, type HullSpec } from "./GearCatalog";
import { slotToBagModule, applyLoadoutHullToShip } from "./GearBridge";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

export const HULL_TRADE_IN_RATE = 0.4;
export const HULL_TRADE_IN_CONDITION_FLOOR = 0.2;

export function hullTradeInPrice(
  hull: HullSpec,
  hullHP?: number,
  maxHull?: number,
): number {
  const conditionFactor =
    hullHP === undefined || maxHull === undefined || maxHull <= 0
      ? 1
      : Math.max(HULL_TRADE_IN_CONDITION_FLOOR, Math.min(1, hullHP / maxHull));
  return Math.floor(hull.basePrice * HULL_TRADE_IN_RATE * conditionFactor);
}

export interface HullPurchaseResult {
  tradeIn: number;
  netCharge: number;
  oldHullId: string;
  dropped: Array<{ gearId: string; micromoduleId?: string; upgrades?: number }>;
}

export function buyHullWithTradeIn(
  access: BankAccess | null | undefined,
  player: Player,
  loadout: ShipLoadout,
  newHull: HullSpec,
  price: number,
): HullPurchaseResult {
  const oldHull = loadout.hull;
  const tradeIn =
    oldHull.id === newHull.id
      ? 0
      : hullTradeInPrice(oldHull, player.ship.hullHP, player.ship.maxHull);

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
