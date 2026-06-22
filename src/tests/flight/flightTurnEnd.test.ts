import { describe, it, expect, vi } from "vitest";
import {
  endFlightTurn,
  type FlightPositionSink,
} from "@/presentation/flight/flightTurnEnd";
import type { ShipPhysics } from "@/systems/ShipPhysics";

/**
 * Reload-resume capture (playtest 2026-06-22 #1): free flight has no autosave
 * trigger of its own, so the scene calls endFlightTurn on each turn-end to settle
 * the ship AND persist where it stopped. This locks both halves + the null-engine
 * (bare-scene) path so the ship still stops even without an engine to save into.
 */
describe("endFlightTurn", () => {
  function makePhysics(x: number, y: number) {
    return {
      shipX: x,
      shipY: y,
      isMoving: true,
      currentSpeed: 5,
      setTarget: vi.fn(),
    } as unknown as ShipPhysics & { setTarget: ReturnType<typeof vi.fn> };
  }

  it("settles the ship in place, captures the position, and autosaves", () => {
    const physics = makePhysics(120, 340);
    const saveGame = vi.fn().mockResolvedValue(undefined);
    const engine: FlightPositionSink = { liveFlightShipPos: null, saveGame };

    endFlightTurn(physics, engine);

    expect(physics.setTarget).toHaveBeenCalledWith(120, 340);
    expect(physics.isMoving).toBe(false);
    expect(physics.currentSpeed).toBe(0);
    expect(engine.liveFlightShipPos).toEqual({ x: 120, y: 340 });
    expect(saveGame).toHaveBeenCalledWith("auto");
  });

  it("still settles the ship when no engine is wired (bare scene)", () => {
    const physics = makePhysics(7, 9);

    expect(() => endFlightTurn(physics, null)).not.toThrow();

    expect(physics.setTarget).toHaveBeenCalledWith(7, 9);
    expect(physics.isMoving).toBe(false);
    expect(physics.currentSpeed).toBe(0);
  });

  it("does not throw when the engine has no saveGame method", () => {
    const physics = makePhysics(1, 2);
    const engine: FlightPositionSink = { liveFlightShipPos: null };

    expect(() => endFlightTurn(physics, engine)).not.toThrow();

    expect(engine.liveFlightShipPos).toEqual({ x: 1, y: 2 });
  });
});
