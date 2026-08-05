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
