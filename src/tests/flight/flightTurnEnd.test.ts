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

import {
  handleFlightPlayPause,
  type PlayPauseHost,
} from "@/presentation/flight/flightTurnEnd";

/**
 * Review 2026-07-15: the HUD «Ход»/«Пауза» button pressed DURING a confirmed
 * execute window used to hit the combat-abort branch → `endTurn()`, freezing
 * `CombatModule` (its `isPaused` includes `!isTurnRunning`) while the round
 * clock kept cycling — a permanent zero-fire planning loop. Task 1b: the round
 * timer is the single terminator, so mid-window the button is a no-op.
 */
describe("handleFlightPlayPause — pause-and-plan loop guards", () => {
  function makeHost(overrides: Partial<PlayPauseHost> = {}) {
    const host = {
      isCombatPaused: () => false,
      isPlanning: () => false,
      isExecutingPlan: () => false,
      confirmPlan: vi.fn(),
      isTurnRunning: () => false,
      combatAbortActive: () => false,
      endTurn: vi.fn(),
      pauseLatched: () => false,
      setPauseLatch: vi.fn(),
      plannedRoute: () => null,
      followActive: () => false,
      followTarget: () => null,
      executeRouteTo: vi.fn(),
      beginWaitTurn: vi.fn(),
      showMessage: vi.fn(),
      ...overrides,
    };
    return host as PlayPauseHost & typeof host;
  }

  it("is a no-op during a confirmed execute window (no combat-abort endTurn)", () => {
    const host = makeHost({
      isExecutingPlan: () => true,
      isTurnRunning: () => true,
      combatAbortActive: () => true, // the fight IS active — abort used to fire
    });
    handleFlightPlayPause(host);
    expect(host.endTurn).not.toHaveBeenCalled();
    expect(host.confirmPlan).not.toHaveBeenCalled();
    expect(host.setPauseLatch).not.toHaveBeenCalled();
    expect(host.beginWaitTurn).not.toHaveBeenCalled();
  });

  it("still confirms during PLANNING", () => {
    const host = makeHost({ isPlanning: () => true });
    handleFlightPlayPause(host);
    expect(host.confirmPlan).toHaveBeenCalledTimes(1);
    expect(host.endTurn).not.toHaveBeenCalled();
  });

  it("still aborts a pre-planning combat auto-follow turn immediately", () => {
    const host = makeHost({
      isTurnRunning: () => true,
      combatAbortActive: () => true, // chase/follow — no execute window running
    });
    handleFlightPlayPause(host);
    expect(host.endTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps the day-boundary pause latch for an ordinary running turn", () => {
    const host = makeHost({ isTurnRunning: () => true });
    handleFlightPlayPause(host);
    expect(host.setPauseLatch).toHaveBeenCalledWith(true);
    expect(host.endTurn).not.toHaveBeenCalled();
  });
});
