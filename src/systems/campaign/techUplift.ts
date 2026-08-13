import { TECH_UPLIFT_DAYS, TECH_UPLIFT_CAP } from "@/config/balance";
import { getEconomyOverrides } from "@/config/economyOverrides";

export function techLevelWithUplift(baseTech: number, day: number): number {
  const overrides = getEconomyOverrides();
  const upliftDays = overrides.techUpliftDays ?? TECH_UPLIFT_DAYS;
  const upliftCap = overrides.techUpliftCap ?? TECH_UPLIFT_CAP;
  const base = Math.max(1, Math.floor(baseTech));
  if (!Number.isFinite(day) || day <= 0) return Math.min(upliftCap, base);
  const uplift = Math.floor(day / Math.max(1, upliftDays));
  return Math.min(upliftCap, base + uplift);
}
