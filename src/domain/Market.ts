import type { ResourceType } from '@/types';
import type { Planet } from './Planet';
import type { Inventory } from './Inventory';

export interface TransactionResult {
  readonly success: boolean;
  readonly finalPrice: number;
  readonly remainingBalance: number;
  readonly message: string;
}

export class Market {
  constructor(
    public readonly availableResources: ResourceType[],
    public demandVector: number[],
    public supplyVector: number[],
    public readonly planet?: Planet,
  ) {}

  getPrice(resourceType: ResourceType): number {
    const idx = this.availableResources.indexOf(resourceType);
    if (idx < 0) return 0;
    const demand = this.demandVector[idx] ?? 1;
    const supply = Math.max(this.supplyVector[idx] ?? 1, 0.01);
    return Math.round((demand / supply) * 100);
  }

  trade(
    playerInventory: Inventory,
    playerCredits: { value: number },
    resourceType: ResourceType,
    amount: number,
    isBuy: boolean,
  ): TransactionResult {
    const price = this.getPrice(resourceType);
    const totalPrice = price * amount;

    if (isBuy) {
      if (playerCredits.value < totalPrice) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: playerCredits.value,
          message: 'Insufficient credits.',
        };
      }
      playerCredits.value -= totalPrice;
      const stack = playerInventory.resources.find((r) => r.type === resourceType);
      if (stack) {
        stack.amount += amount;
      } else {
        playerInventory.resources.push({ type: resourceType, amount });
      }
    } else {
      const stack = playerInventory.resources.find((r) => r.type === resourceType);
      if (!stack || stack.amount < amount) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: playerCredits.value,
          message: 'Not enough resources to sell.',
        };
      }
      stack.amount -= amount;
      playerCredits.value += totalPrice;
    }

    return {
      success: true,
      finalPrice: totalPrice,
      remainingBalance: playerCredits.value,
      message: 'Transaction completed.',
    };
  }
}
