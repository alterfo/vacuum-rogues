export interface EconomyOverrides {
  techUpliftDays?: number;
  techUpliftCap?: number;
  rareStockFactor?: number;
  hullTradeInRate?: number;
  minDayReduction?: number;
  shopRerollNonce?: number;
}

const overrides: EconomyOverrides = {};

export function getEconomyOverrides(): Readonly<EconomyOverrides> {
  return overrides;
}

export function setEconomyOverride<K extends keyof EconomyOverrides>(
  key: K,
  value: EconomyOverrides[K],
): void {
  overrides[key] = value;
}

export function resetEconomyOverrides(): void {
  for (const key of Object.keys(overrides) as (keyof EconomyOverrides)[]) {
    delete overrides[key];
  }
}

export function bumpShopRerollNonce(): void {
  overrides.shopRerollNonce = (overrides.shopRerollNonce ?? 0) + 1;
}
