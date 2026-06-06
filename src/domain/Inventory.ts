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

  hasResources(cost: ResourceStack[]): boolean {
    return cost.every((c) => {
      const stack = this.resources.find((r) => r.type === c.type);
      return (stack?.amount ?? 0) >= c.amount;
    });
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
}
