import type { Player } from "@/domain/Player";
import type { MicroModule } from "@/types";
import { MICRO_MODULES, HULL_MICRO_MODULES } from "./GearCatalog";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

export const MICROMODULE_TIER_PRICE = [0, 3200, 1800, 800] as const;

export function micromodulePrice(mm: MicroModule): number {
  return MICROMODULE_TIER_PRICE[mm.bonusTier];
}

export function micromoduleShopCatalog(): MicroModule[] {
  return [...MICRO_MODULES, ...HULL_MICRO_MODULES];
}

export function playerOwnsMicromodule(player: Player, id: string): boolean {
  return player.inventory.micromodules.some((m) => m.id === id);
}

export type BuyMicromoduleResult =
  | { ok: true; price: number }
  | { ok: false; reason: "already-owned" | "insufficient-credits" };

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
