import type { FlightShipPos } from "@/domain/SaveState";
import { logger } from "@/utils/logger";

export interface FlightPositionTrackerDeps {
  isSpaceFlightActive: () => boolean;
  hasActiveGame: () => boolean;
  saveGame: (slotId?: string) => Promise<void>;
  persistLiveSceneState?: () => void;
}

export class FlightPositionTracker {
  constructor(private readonly deps: FlightPositionTrackerDeps) {}

  liveFlightShipPos: { x: number; y: number } | null = null;
  lastFlightShipPos: { x: number; y: number } | null = null;
  private flightShipPos: FlightShipPos | null = null;

  private flightHideHandler: (() => void) | null = null;
  private flightVisibilityHandler: (() => void) | null = null;

  get persistedFlightShipPos(): FlightShipPos | null {
    return this.flightShipPos;
  }
  set persistedFlightShipPos(pos: FlightShipPos | null) {
    this.flightShipPos = pos;
  }

  forgetFlightPosition(): void {
    this.liveFlightShipPos = null;
    this.flightShipPos = null;
  }

  recordLiveFlightPos(x: number, y: number): void {
    this.liveFlightShipPos = { x, y };
  }

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

  async flushFlightAutosave(): Promise<void> {
    if (!this.deps.isSpaceFlightActive()) return;
    if (!this.deps.hasActiveGame()) return;
    this.deps.persistLiveSceneState?.();
    await this.deps.saveGame("auto");
  }

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
