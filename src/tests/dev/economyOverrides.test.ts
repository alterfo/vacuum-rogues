import { describe, it, expect, afterEach } from "vitest";
import {
  getEconomyOverrides,
  setEconomyOverride,
  resetEconomyOverrides,
  bumpShopRerollNonce,
} from "@/config/economyOverrides";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import { hullTradeInPrice } from "@/systems/equipment/sellHull";
import { generateShop, shopBucket } from "@/systems/equipment/ShopGenerator";
import { TECH_UPLIFT_DAYS, TECH_UPLIFT_CAP } from "@/config/balance";
import { HULL_TRADE_IN_RATE } from "@/systems/equipment/sellHull";
import {
  gearById,
  isRareGear,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";

afterEach(() => {
  resetEconomyOverrides();
});

describe("economyOverrides — dev-only seam, inert by default", () => {
  it("starts with no overrides set", () => {
    expect(getEconomyOverrides()).toEqual({});
  });

  it("techLevelWithUplift matches base constants absent an override", () => {
    expect(techLevelWithUplift(3, TECH_UPLIFT_DAYS)).toBe(4);
    expect(techLevelWithUplift(5, 100 * TECH_UPLIFT_DAYS)).toBe(
      TECH_UPLIFT_CAP,
    );
  });

  it("setEconomyOverride(techUpliftDays) changes the uplift cadence", () => {
    setEconomyOverride("techUpliftDays", 10);
    expect(techLevelWithUplift(3, 10)).toBe(4);
    expect(techLevelWithUplift(3, TECH_UPLIFT_DAYS)).toBeGreaterThan(4);
  });

  it("setEconomyOverride(techUpliftCap) changes the ceiling", () => {
    setEconomyOverride("techUpliftCap", 3);
    expect(techLevelWithUplift(3, 100 * TECH_UPLIFT_DAYS)).toBe(3);
  });

  it("hullTradeInPrice matches HULL_TRADE_IN_RATE absent an override", () => {
    const hull = gearById("hull_scout") as HullSpec;
    expect(hullTradeInPrice(hull)).toBe(
      Math.floor(hull.basePrice * HULL_TRADE_IN_RATE),
    );
  });

  it("setEconomyOverride(hullTradeInRate) changes the trade-in price", () => {
    const hull = gearById("hull_scout") as HullSpec;
    setEconomyOverride("hullTradeInRate", 1);
    expect(hullTradeInPrice(hull)).toBe(hull.basePrice);
  });

  it("setEconomyOverride(rareStockFactor) changes rare-gear stock odds deterministically", () => {
    const opts = {
      systemId: "s1",
      planetId: "p1",
      seed: "seed-a",
      day: 100,
    };
    setEconomyOverride("rareStockFactor", 0);
    const withZeroRareStock = generateShop(opts).filter((l) =>
      isRareGear(l.gear),
    );
    expect(withZeroRareStock).toEqual([]);
  });

  it("setEconomyOverride(minDayReduction) can admit a minDay-gated item before its minDay", () => {
    const gated = gearById("eq_engine_v")!;
    const minDay = gated.minDay!;
    const day = minDay - 5;
    const seeds = Array.from({ length: 40 }, (_, i) => `probe-${i}`);
    const stocksAt = (): boolean =>
      seeds.some((seed) =>
        generateShop({
          systemId: "s1",
          planetId: "p1",
          seed,
          day,
          maxTechLevel: gated.techLevel,
        }).some((l) => l.gear.id === gated.id),
      );

    expect(stocksAt()).toBe(false);
    setEconomyOverride("minDayReduction", 5);
    expect(stocksAt()).toBe(true);
  });

  it("bumpShopRerollNonce changes the shop bucket without changing the day", () => {
    const before = shopBucket(70);
    bumpShopRerollNonce();
    expect(shopBucket(70)).toBe(before + 1);
    bumpShopRerollNonce();
    expect(shopBucket(70)).toBe(before + 2);
  });

  it("resetEconomyOverrides clears every override back to base behaviour", () => {
    setEconomyOverride("techUpliftDays", 5);
    setEconomyOverride("hullTradeInRate", 0.9);
    bumpShopRerollNonce();
    resetEconomyOverrides();
    expect(getEconomyOverrides()).toEqual({});
    expect(techLevelWithUplift(3, TECH_UPLIFT_DAYS)).toBe(4);
  });
});
