import { describe, it, expect } from "vitest";
import { FlightSessionState } from "@/systems/FlightSessionState";

describe("FlightSessionState — offered-encounter + salvage anti-farm bookkeeping (Task 5)", () => {
  it("offers each encounter id at most once", () => {
    const state = new FlightSessionState();
    expect(state.hasOfferedEncounter("enc:sys1:5")).toBe(false);
    state.markEncounterOffered("enc:sys1:5");
    expect(state.hasOfferedEncounter("enc:sys1:5")).toBe(true);
    expect(state.hasOfferedEncounter("enc:sys1:6")).toBe(false);
  });

  it("caps the running salvage total per galaxy day, then resets on a new day", () => {
    const state = new FlightSessionState();
    expect(state.salvagedTodayFor(0)).toBe(0);
    state.recordSalvage(400);
    expect(state.salvagedTodayFor(0)).toBe(400);
    state.recordSalvage(300);
    expect(state.salvagedTodayFor(0)).toBe(700);

    expect(state.salvagedTodayFor(1)).toBe(0);
    state.recordSalvage(50);
    expect(state.salvagedTodayFor(1)).toBe(50);
  });

  it("resetForNewSession clears offered encounters and the salvage total", () => {
    const state = new FlightSessionState();
    state.markEncounterOffered("enc:sys1:5");
    state.recordSalvage(999);
    state.salvagedTodayFor(3);

    state.resetForNewSession();

    expect(state.hasOfferedEncounter("enc:sys1:5")).toBe(false);
    expect(state.offeredEncounterIds.size).toBe(0);
    expect(state.salvagedTodayFor(3)).toBe(0);
  });
});
