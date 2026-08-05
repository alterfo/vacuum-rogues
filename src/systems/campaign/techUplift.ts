import { TECH_UPLIFT_DAYS, TECH_UPLIFT_CAP } from "@/config/balance";

export function techLevelWithUplift(baseTech: number, day: number): number {
  const base = Math.max(1, Math.floor(baseTech));
  if (!Number.isFinite(day) || day <= 0) return Math.min(TECH_UPLIFT_CAP, base);
  const uplift = Math.floor(day / Math.max(1, TECH_UPLIFT_DAYS));
  return Math.min(TECH_UPLIFT_CAP, base + uplift);
}
