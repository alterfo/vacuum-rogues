import type { ShipPhysics } from "@/systems/ShipPhysics";
import { t } from "@/i18n/i18n";
import { logger } from "@/utils/logger";

export interface FlightPositionSink {
  liveFlightShipPos: { x: number; y: number } | null;
  saveGame?: (slotId?: string) => Promise<void>;
}

export interface FlightAutosaveSink {
  recordLiveFlightPos(x: number, y: number): void;
  flushFlightAutosave(): Promise<void>;
}

export interface FlightAutosaveState {
  accumMs: number;
  lastPos: { x: number; y: number } | null;
}

const FLIGHT_AUTOSAVE_INTERVAL_MS = 5000;

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

export interface PlayPauseHost {
  isCombatPaused(): boolean;
  isPlanning(): boolean;
  isExecutingPlan?(): boolean;
  hasOpenModal?(): boolean;
  confirmPlan(): void;
  isTurnRunning(): boolean;
  combatAbortActive(): boolean;
  endTurn(): void;
  pauseLatched(): boolean;
  setPauseLatch(v: boolean): void;
  plannedRoute(): { x: number; y: number } | null;
  followActive(): boolean;
  followTarget(): { x: number; y: number } | null;
  executeRouteTo(x: number, y: number): void;
  beginWaitTurn(): void;
  showMessage(text: string, color?: number): void;
}

export function handleFlightPlayPause(host: PlayPauseHost): void {
  if (host.isCombatPaused()) return;
  if (host.isPlanning()) {
    if (!host.hasOpenModal?.()) host.confirmPlan();
    return;
  }
  if (host.isExecutingPlan?.()) return; // round timer is the sole terminator (Task 1b)
  if (host.isTurnRunning()) {
    if (host.combatAbortActive()) {
      host.endTurn(); // combat abort halts now (endTurn stops the ship)
    } else if (!host.pauseLatched()) {
      host.setPauseLatch(true);
      host.showMessage(t("flight.turn.finishingDay"), 0x88ccff);
    }
    return;
  }
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
