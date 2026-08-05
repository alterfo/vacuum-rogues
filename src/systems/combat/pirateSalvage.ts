export function pirateSalvageAmount(
  npcCredits: number,
  fraction: number,
  salvagedToday: number,
  dailyCap: number,
): number {
  const raw = Math.floor(Math.max(0, npcCredits) * fraction);
  const remaining = Math.max(0, dailyCap - salvagedToday);
  return Math.max(0, Math.min(raw, remaining));
}
