import type { Player } from "@/domain/Player";
import { gearById, type Gear } from "./GearCatalog";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

export const SELL_RATE = 0.4;

export function sellGearPrice(gear: Gear): number {
  return Math.floor(gear.basePrice * SELL_RATE);
}

function creditSale(
  player: Player,
  gear: Gear,
  bank?: BankAccess | null,
): number {
  const refund = sellGearPrice(gear);
  adjustPlayerCredits(
    bank,
    player,
    refund,
    GL_COUNTERPARTY.EQUIPMENT,
    `Продажа: ${gear.name}`,
  );
  return refund;
}

export function sellUninstalledGear(
  player: Player,
  gearId: string,
  bank?: BankAccess | null,
): number {
  const gear = gearById(gearId);
  if (!gear) return 0;
  if (!player.inventory.removeOwnedGear(gearId)) return 0;
  return creditSale(player, gear, bank);
}

export function sellLegacyModule(
  player: Player,
  index: number,
  bank?: BankAccess | null,
): number {
  const mod = player.inventory.modules[index];
  if (!mod) return 0;
  const gear = gearById(mod.id);
  if (!gear) return 0;
  player.inventory.modules.splice(index, 1);
  return creditSale(player, gear, bank);
}
