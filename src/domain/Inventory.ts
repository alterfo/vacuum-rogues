import type { ResourceType, MicroModule } from "@/types";
import type { ShipModule } from "./ShipModule";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

export interface ResourceStack {
  readonly type: ResourceType;
  amount: number;
}

export interface CosmeticItem {
  readonly id: string;
  readonly name: string;
}

export class Inventory {
  modules: ShipModule[] = [];
  micromodules: MicroModule[] = [];
  resources: ResourceStack[] = [];
  cosmetics: CosmeticItem[] = [];
  /**
   * Canonical store of gear the player owns but has **not** installed (catalog
   * gear ids). Replaces the ad-hoc "legacy bag" role: purchases/loot that aren't
   * auto-installed land here; installing moves an id out (into the loadout) and
   * unequipping moves it back. Read through `ownedUninstalledGear` (GearBridge),
   * the single accessor both the hangar and equipment-shop ТРЮМ views consume.
   */
  ownedGearIds: string[] = [];

  addItem(item: ShipModule | CosmeticItem): void {
    if ("category" in item) {
      this.modules.push(item);
    } else {
      this.cosmetics.push(item);
    }
  }

  removeItem(itemId: string): void {
    const modIndex = this.modules.findIndex((m) => m.id === itemId);
    if (modIndex >= 0) {
      this.modules.splice(modIndex, 1);
      return;
    }
    const cosIndex = this.cosmetics.findIndex((c) => c.id === itemId);
    if (cosIndex >= 0) {
      this.cosmetics.splice(cosIndex, 1);
      return;
    }
    throw new GameBusinessException(
      "ITEM_NOT_FOUND",
      `Item ${itemId} not found in inventory.`,
      { itemId },
    );
  }

  /** Record a gear id as owned-but-uninstalled (a purchase/loot with no free slot). */
  addOwnedGear(gearId: string): void {
    (this.ownedGearIds ??= []).push(gearId);
  }

  /** Remove the first owned copy of a gear id. Returns true if one was removed. */
  removeOwnedGear(gearId: string): boolean {
    const list = (this.ownedGearIds ??= []);
    const i = list.indexOf(gearId);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  hasResources(cost: ResourceStack[]): boolean {
    return cost.every((c) => {
      const stack = this.resources.find((r) => r.type === c.type);
      return (stack?.amount ?? 0) >= c.amount;
    });
  }

  addResource(type: ResourceType, amount: number): void {
    const existing = this.resources.find((r) => r.type === type);
    if (existing) {
      existing.amount += amount;
    } else {
      this.resources.push({ type, amount });
    }
  }

  consumeResources(cost: ResourceStack[]): void {
    if (!this.hasResources(cost)) {
      throw new GameBusinessException(
        "INSUFFICIENT_RESOURCES",
        "Not enough resources for this operation.",
        { cost },
      );
    }
    for (const c of cost) {
      const stack = this.resources.find((r) => r.type === c.type);
      if (stack) {
        stack.amount -= c.amount;
      }
    }
  }

  /**
   * Jettison-to-space: remove `amount` of a held resource, no credit refund
   * (selling is the separate paid path). Throws when the type isn't held or
   * the requested amount exceeds the stack — same error code
   * {@link consumeResources} uses for an insufficient stack.
   */
  removeResource(type: ResourceType, amount: number): void {
    const stack = this.resources.find((r) => r.type === type);
    if (!stack || stack.amount < amount) {
      throw new GameBusinessException(
        "INSUFFICIENT_RESOURCES",
        `Not enough ${type} to remove.`,
        { type, amount },
      );
    }
    stack.amount -= amount;
  }
}
