/**
 * Transient (non-persisted) anti-farm bookkeeping shared by `GameEngine` and
 * `NpcShipManager` (plan Task 5): which exploration encounters this session
 * has already offered, and the running per-galaxy-day pirate-salvage total.
 * Held on the long-lived `GameEngine` — not the per-scene `NpcShipManager`,
 * rebuilt on every warp/land→take-off/star-map round trip — so both caps
 * survive a scene rebuild instead of re-arming on every system entry.
 * Deliberately NOT in SaveState/schemas.ts; reset on «Новая игра» via
 * {@link FlightSessionState.resetForNewSession}.
 */
export class FlightSessionState {
  readonly offeredEncounterIds = new Set<string>();
  salvageDay = -1;
  salvagedToday = 0;

  hasOfferedEncounter(id: string): boolean {
    return this.offeredEncounterIds.has(id);
  }

  markEncounterOffered(id: string): void {
    this.offeredEncounterIds.add(id);
  }

  /**
   * Rolls the running salvage total over to `day` if the galaxy day has
   * advanced since the last award, then returns the (possibly reset) total.
   */
  salvagedTodayFor(day: number): number {
    if (day !== this.salvageDay) {
      this.salvageDay = day;
      this.salvagedToday = 0;
    }
    return this.salvagedToday;
  }

  recordSalvage(amount: number): void {
    this.salvagedToday += amount;
  }

  resetForNewSession(): void {
    this.offeredEncounterIds.clear();
    this.salvageDay = -1;
    this.salvagedToday = 0;
  }
}
