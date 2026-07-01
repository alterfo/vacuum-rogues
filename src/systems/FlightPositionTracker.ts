import type { FlightShipPos } from "@/domain/SaveState";
import { logger } from "@/utils/logger";

/**
 * Everything {@link FlightPositionTracker} needs from `GameEngine` to decide
 * when a periodic flush is valid, and how to actually persist it.
 */
export interface FlightPositionTrackerDeps {
  isSpaceFlightActive: () => boolean;
  hasActiveGame: () => boolean;
  saveGame: (slotId?: string) => Promise<void>;
}

/**
 * Owns the flight-position persistence cluster (extracted from `GameEngine`,
 * Phase 2 Task 11): the live per-frame capture (`liveFlightShipPos`), the
 * scene-exit snapshot (`lastFlightShipPos`), the sticky system-tagged copy
 * persisted in the save (`flightShipPos`), and the page-hide autosave
 * plumbing. `GameEngine` keeps `lastFlightShipPos`/`liveFlightShipPos` as
 * public getter/setter compat accessors delegating here — both fields have
 * 13+ external readers (SpaceFlightScene, InventoryScene, flightTurnEnd,
 * observe.ts, several tests) that must keep working unchanged.
 */
export class FlightPositionTracker {
  constructor(private readonly deps: FlightPositionTrackerDeps) {}

  /** Live in-flight ship position captured on each turn-end during FREE flight. */
  liveFlightShipPos: { x: number; y: number } | null = null;
  /** The ship's world position when the player last left flight for another scene. */
  lastFlightShipPos: { x: number; y: number } | null = null;
  /** Sticky, system-tagged copy of the last in-flight position, persisted in the save. */
  private flightShipPos: FlightShipPos | null = null;

  /** Retained page-hide autosave handlers so {@link unregisterFlightHideAutosave} can detach them. */
  private flightHideHandler: (() => void) | null = null;
  private flightVisibilityHandler: (() => void) | null = null;

  /** The persisted, system-tagged flight position (read/written by save/load). */
  get persistedFlightShipPos(): FlightShipPos | null {
    return this.flightShipPos;
  }
  set persistedFlightShipPos(pos: FlightShipPos | null) {
    this.flightShipPos = pos;
  }

  /**
   * Invalidate the ship's captured free-flight position. Called when the ship
   * lands (it is parked on a planet, not at a free-flight position). Drops BOTH
   * the live turn-end capture (`liveFlightShipPos`) AND the sticky persisted
   * position (`flightShipPos`): the latter is otherwise only ever overwritten
   * (never cleared) by `saveGame`, so without this a take-off autosave would
   * re-persist the stale pre-landing position and the next reload would teleport
   * the ship there. The ship re-establishes `flightShipPos` on its first
   * post-takeoff turn-end. (System exit clears `liveFlightShipPos` in
   * `performWarp`; the load-time systemId guard covers the cross-system case —
   * landing is the same-system case that guard cannot catch.)
   */
  forgetFlightPosition(): void {
    this.liveFlightShipPos = null;
    this.flightShipPos = null;
  }

  /**
   * Continuously capture the live in-flight ship position. Called every frame
   * from the flight scene so a later autosave (turn-end, periodic, or the
   * page-hide flush below) persists where the ship actually IS — not the stale
   * system-entry edge.
   */
  recordLiveFlightPos(x: number, y: number): void {
    this.liveFlightShipPos = { x, y };
  }

  /**
   * Resolve the flight position to persist in a `saveGame` call: refresh the
   * sticky, system-tagged `flightShipPos` from the live one whenever the flight
   * scene has set it. `lastFlightShipPos` is written right before a scene exit
   * (star map / inventory / combat) and consumed to null on the next flight
   * entry; `liveFlightShipPos` is the free-flight turn-end capture (only valid
   * while SPACE_FLIGHT is the active scene). Kept sticky — a later non-flight
   * autosave must not clear the last good position.
   */
  captureForSave(currentSystemId: string | null): FlightShipPos | undefined {
    const livePos =
      this.lastFlightShipPos ??
      (this.deps.isSpaceFlightActive() ? this.liveFlightShipPos : null);
    if (livePos && currentSystemId) {
      this.flightShipPos = {
        x: livePos.x,
        y: livePos.y,
        systemId: currentSystemId,
      };
    }
    return this.flightShipPos ?? undefined;
  }

  /**
   * Persist the live in-flight position on page-hide
   * (`visibilitychange`→hidden / `beforeunload`) so a reload mid-flight resumes
   * the live position instead of edge-spawning. No-op outside flight, and the
   * field is only valid while SPACE_FLIGHT is the active scene (saveGame's own
   * gate). Best-effort under `beforeunload` (the async write may not finish
   * before unload), but `visibilitychange`→hidden fires reliably on mobile/tab
   * backgrounding where the write does complete.
   */
  async flushFlightAutosave(): Promise<void> {
    if (!this.deps.isSpaceFlightActive()) return;
    if (!this.deps.hasActiveGame()) return;
    await this.deps.saveGame("auto");
  }

  /**
   * Register the one-time page-hide autosave listeners. Survives scene
   * transitions (registered once at engine init), guarded for non-browser
   * runtimes (bare Vitest constructs the engine without calling `initialize`).
   */
  registerFlightHideAutosave(): void {
    if (typeof window === "undefined" || this.flightHideHandler) return;
    const flush = (): void => {
      void this.flushFlightAutosave().catch((e) =>
        logger.error("Flight hide autosave failed:", e),
      );
    };
    this.flightHideHandler = flush;
    window.addEventListener("beforeunload", this.flightHideHandler);
    if (typeof document !== "undefined") {
      this.flightVisibilityHandler = (): void => {
        if (document.visibilityState === "hidden") flush();
      };
      document.addEventListener(
        "visibilitychange",
        this.flightVisibilityHandler,
      );
    }
  }

  /** Detach the page-hide autosave listeners (called from `GameEngine.stop`). */
  unregisterFlightHideAutosave(): void {
    if (this.flightHideHandler && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.flightHideHandler);
    }
    if (this.flightVisibilityHandler && typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.flightVisibilityHandler,
      );
    }
    this.flightHideHandler = null;
    this.flightVisibilityHandler = null;
  }
}
