import type { ShipPhysics } from "@/systems/ShipPhysics";
import { t } from "@/i18n/i18n";
import { logger } from "@/utils/logger";

/**
 * Minimal engine seam the capture needs — declared structurally (not as a
 * GameEngine import) to keep this flight helper free of an import cycle.
 */
export interface FlightPositionSink {
  liveFlightShipPos: { x: number; y: number } | null;
  saveGame?: (slotId?: string) => Promise<void>;
}

/** Engine seam for the per-frame live capture + periodic in-flight autosave. */
export interface FlightAutosaveSink {
  recordLiveFlightPos(x: number, y: number): void;
  flushFlightAutosave(): Promise<void>;
}

/** Scene-owned throttle state for {@link recordAndMaybeAutosaveFlight}. */
export interface FlightAutosaveState {
  accumMs: number;
  lastPos: { x: number; y: number } | null;
}

const FLIGHT_AUTOSAVE_INTERVAL_MS = 5000;

/**
 * Track the live ship position into the engine every frame (so a page-hide
 * flush / next save persists where the ship IS, not the system-entry edge) and
 * throttle a periodic autosave (~5 s) when the ship has actually moved — so a
 * crash/close that never fires `visibilitychange` still resumes near the live
 * position. Turn-end already saves the settled position; this fills the gap
 * mid-turn and during a combat orbit (which moves the ship with no turn-end).
 * Mutates `state` in place.
 */
export function recordAndMaybeAutosaveFlight(
  engine: FlightAutosaveSink,
  physics: ShipPhysics,
  state: FlightAutosaveState,
  deltaTime: number,
): void {
  const { shipX, shipY } = physics;
  engine.recordLiveFlightPos(shipX, shipY);
  state.accumMs += deltaTime;
  if (state.accumMs < FLIGHT_AUTOSAVE_INTERVAL_MS) return;
  state.accumMs = 0;
  const moved =
    !state.lastPos ||
    Math.hypot(shipX - state.lastPos.x, shipY - state.lastPos.y) > 1;
  if (!moved) return;
  state.lastPos = { x: shipX, y: shipY };
  engine
    .flushFlightAutosave()
    .catch((e) => logger.error("Periodic flight autosave failed:", e));
}

/**
 * Finalize the ship at the end of a flight turn: settle it in place, then
 * persist its position so a browser reload resumes the ship where it stopped.
 *
 * Free flight has no other autosave trigger — scene transitions run after
 * `lastFlightShipPos` is consumed, and the warp save fires before it is set — so
 * this discrete turn-end is where the live position is captured. The engine
 * folds `liveFlightShipPos` into the saved, system-tagged `flightShipPos`
 * (`performWarp` clears it when the ship leaves the system). A null engine
 * (bare-scene unit tests) still settles the ship but skips the save.
 */
export function endFlightTurn(
  physics: ShipPhysics,
  engine: FlightPositionSink | null,
): void {
  physics.setTarget(physics.shipX, physics.shipY);
  physics.isMoving = false;
  physics.currentSpeed = 0;
  if (!engine) return;
  engine.liveFlightShipPos = { x: physics.shipX, y: physics.shipY };
  engine
    .saveGame?.("auto")
    ?.catch((e) => logger.error("Auto-save on turn end failed:", e));
}

/** The scene members the Play/Pause turn control reads (extracted verbatim from
 *  `SpaceFlightScene.onPlayPause` for the line guard, 14.5c — lazy closures). */
export interface PlayPauseHost {
  isCombatPaused(): boolean;
  isPlanning(): boolean;
  confirmPlan(): void;
  isTurnRunning(): boolean;
  /** A combat auto-follow / active fight — the pause aborts the turn NOW. */
  combatAbortActive(): boolean;
  endTurn(): void;
  pauseLatched(): boolean;
  setPauseLatch(v: boolean): void;
  plannedRoute(): { x: number; y: number } | null;
  followActive(): boolean;
  followTarget(): { x: number; y: number } | null;
  executeRouteTo(x: number, y: number): void;
  /** Course-less wait turn: time passes, the ship holds position (US-070 #5). */
  beginWaitTurn(): void;
  showMessage(text: string, color?: number): void;
}

/**
 * Play/Pause turn control. Paused: Play executes the planned route. Running:
 * Pause defers the stop to the next whole-day boundary (F1, playtest3) — except
 * a combat auto-follow, which aborts immediately (combat freezes the calendar,
 * so the day-boundary latch would never fire). During PLANNING the button is
 * the mouse equivalent of Space's confirm (14.5a). Suppressed while the active-
 * pause overlay is open — else a stray click desyncs `isTurnRunning`.
 */
export function handleFlightPlayPause(host: PlayPauseHost): void {
  if (host.isCombatPaused()) return;
  if (host.isPlanning()) {
    host.confirmPlan();
    return;
  }
  if (host.isTurnRunning()) {
    if (host.combatAbortActive()) {
      host.endTurn(); // combat abort halts now (endTurn stops the ship)
    } else if (!host.pauseLatched()) {
      host.setPauseLatch(true);
      host.showMessage(t("flight.turn.finishingDay"), 0x88ccff);
    }
    return;
  }
  // Play: run the planned route (or close on an attack target). With no course
  // at all, run a "wait" turn — time passes, the ship holds position.
  host.setPauseLatch(false); // fresh turn — clear any stale latch
  const route = host.plannedRoute();
  if (route) {
    host.executeRouteTo(route.x, route.y);
  } else if (host.followActive()) {
    const target = host.followTarget();
    if (target) host.executeRouteTo(target.x, target.y);
  } else {
    host.beginWaitTurn();
  }
}
