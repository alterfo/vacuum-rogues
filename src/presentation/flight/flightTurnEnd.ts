import type { ShipPhysics } from "@/systems/ShipPhysics";
import { logger } from "@/utils/logger";

/**
 * Minimal engine seam the capture needs — declared structurally (not as a
 * GameEngine import) to keep this flight helper free of an import cycle.
 */
export interface FlightPositionSink {
  liveFlightShipPos: { x: number; y: number } | null;
  saveGame?: (slotId?: string) => Promise<void>;
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
