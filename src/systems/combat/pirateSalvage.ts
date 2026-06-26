/**
 * Pure salvage-payout math for destroying a credit-carrying NPC (Task 5 of the
 * late-game recoverability pass). Killing a pirate now pays out a *fraction* of
 * the wreck's cash, routed through the ledger by the caller — but with a
 * per-galaxy-day anti-farm cap so respawning pirates can't be an infinite
 * credit faucet. Keeping the cap math pure makes it unit-testable in isolation.
 */

/**
 * Whole-credit salvage award for one kill, after the per-day anti-farm cap.
 *
 * @param npcCredits    the killed NPC's credits (the wreck's cash)
 * @param fraction      fraction of those credits the player salvages (0..1)
 * @param salvagedToday running salvage total already paid this galaxy day
 * @param dailyCap      max salvage credits payable per galaxy day
 * @returns whole credits to award — never negative, never past the daily cap
 */
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
