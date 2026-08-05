import { describe, it, expect } from "vitest";
import { GAME_BALANCE } from "@/config/balance";

function calcMaxBuyQty(
  credits: number,
  buyPrice: number,
  freeHold: number,
): number {
  return Math.max(
    1,
    Math.min(buyPrice > 0 ? Math.floor(credits / buyPrice) : 99, freeHold),
  );
}

function calcMaxSellQty(owned: number): number {
  return Math.max(1, owned);
}

function isBuyDeal(buyPrice: number, basePrice: number): boolean {
  return buyPrice < basePrice * (1 - GAME_BALANCE.tradeDealThreshold);
}

function isSellDeal(sellPrice: number, basePrice: number): boolean {
  return sellPrice > basePrice * (1 + GAME_BALANCE.tradeDealThreshold);
}

describe("Trade Max button qty calculation", () => {
  it("buy max is limited by credits", () => {
    expect(calcMaxBuyQty(500, 100, 20)).toBe(5);
  });

  it("buy max is limited by free hold", () => {
    expect(calcMaxBuyQty(5000, 10, 3)).toBe(3);
  });

  it("buy max returns 1 minimum even when broke", () => {
    expect(calcMaxBuyQty(0, 100, 10)).toBe(1);
  });

  it("buy max with zero buy price returns min(99, freeHold)", () => {
    expect(calcMaxBuyQty(1000, 0, 50)).toBe(50);
  });

  it("sell max equals owned amount", () => {
    expect(calcMaxSellQty(15)).toBe(15);
  });

  it("sell max returns 1 minimum when owned is 0", () => {
    expect(calcMaxSellQty(0)).toBe(1);
  });

  it("overall max qty is max of buy and sell max", () => {
    const maxBuyQty = calcMaxBuyQty(200, 100, 10);
    const maxSellQty = calcMaxSellQty(8);
    expect(Math.max(maxBuyQty, maxSellQty)).toBe(8);
  });
});

describe("Trade deal threshold constants", () => {
  it("tradeDealThreshold is 0.20", () => {
    expect(GAME_BALANCE.tradeDealThreshold).toBe(0.2);
  });
});

describe("Trade deal highlight logic", () => {
  it("buy is a deal when price is more than 20% below base", () => {
    const basePrice = 100;
    expect(isBuyDeal(79, basePrice)).toBe(true); // 21% below base
    expect(isBuyDeal(80, basePrice)).toBe(false); // exactly at threshold (not strictly below)
    expect(isBuyDeal(81, basePrice)).toBe(false); // only 19% below
  });

  it("sell is a deal when price is more than 20% above base", () => {
    const basePrice = 100;
    expect(isSellDeal(121, basePrice)).toBe(true); // 21% above base
    expect(isSellDeal(120, basePrice)).toBe(false); // exactly at threshold (not strictly above)
    expect(isSellDeal(119, basePrice)).toBe(false); // only 19% above
  });

  it("no deal when buy price equals base price", () => {
    expect(isBuyDeal(100, 100)).toBe(false);
  });

  it("no sell deal when sell price equals base price", () => {
    expect(isSellDeal(100, 100)).toBe(false);
  });
});
