import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FlightPositionTracker,
  type FlightPositionTrackerDeps,
} from "@/systems/FlightPositionTracker";

function makeDeps(
  overrides: Partial<FlightPositionTrackerDeps> = {},
): FlightPositionTrackerDeps {
  return {
    isSpaceFlightActive: () => true,
    hasActiveGame: () => true,
    saveGame: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("FlightPositionTracker", () => {
  describe("recordLiveFlightPos / forgetFlightPosition", () => {
    it("records the live position", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.recordLiveFlightPos(10, 20);
      expect(tracker.liveFlightShipPos).toEqual({ x: 10, y: 20 });
    });

    it("clears the live capture and the persisted position, but not lastFlightShipPos", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.recordLiveFlightPos(10, 20);
      tracker.persistedFlightShipPos = { x: 1, y: 2, systemId: "sys-1" };
      tracker.lastFlightShipPos = { x: 3, y: 4 };

      tracker.forgetFlightPosition();

      expect(tracker.liveFlightShipPos).toBeNull();
      expect(tracker.persistedFlightShipPos).toBeNull();
      expect(tracker.lastFlightShipPos).toEqual({ x: 3, y: 4 });
    });
  });

  describe("captureForSave", () => {
    it("prefers lastFlightShipPos over the live capture, system-tagging it", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.lastFlightShipPos = { x: 100, y: 200 };
      tracker.recordLiveFlightPos(777, 888);

      const result = tracker.captureForSave("sys-1");

      expect(result).toEqual({ x: 100, y: 200, systemId: "sys-1" });
    });

    it("falls back to the live capture while SPACE_FLIGHT is active", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.recordLiveFlightPos(777, 888);

      const result = tracker.captureForSave("sys-1");

      expect(result).toEqual({ x: 777, y: 888, systemId: "sys-1" });
    });

    it("ignores the live capture outside SPACE_FLIGHT", () => {
      const tracker = new FlightPositionTracker(
        makeDeps({ isSpaceFlightActive: () => false }),
      );
      tracker.recordLiveFlightPos(777, 888);

      expect(tracker.captureForSave("sys-1")).toBeUndefined();
    });

    it("requires a currentSystemId to tag a fresh position (systemId guard)", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.recordLiveFlightPos(777, 888);

      expect(tracker.captureForSave(null)).toBeUndefined();
    });

    it("keeps the sticky persisted position across a later capture with nothing new", () => {
      const tracker = new FlightPositionTracker(makeDeps());
      tracker.lastFlightShipPos = { x: 200, y: 300 };
      tracker.captureForSave("sys-1");

      tracker.lastFlightShipPos = null;
      tracker.liveFlightShipPos = null;

      expect(tracker.captureForSave("sys-1")).toEqual({
        x: 200,
        y: 300,
        systemId: "sys-1",
      });
    });
  });

  describe("flushFlightAutosave", () => {
    let deps: FlightPositionTrackerDeps;

    beforeEach(() => {
      deps = makeDeps();
    });

    it("saves when in flight with an active game", async () => {
      const tracker = new FlightPositionTracker(deps);
      await tracker.flushFlightAutosave();
      expect(deps.saveGame).toHaveBeenCalledWith("auto");
    });

    it("no-ops outside SPACE_FLIGHT", async () => {
      deps.isSpaceFlightActive = () => false;
      const tracker = new FlightPositionTracker(deps);
      await tracker.flushFlightAutosave();
      expect(deps.saveGame).not.toHaveBeenCalled();
    });

    it("no-ops without an active game", async () => {
      deps.hasActiveGame = () => false;
      const tracker = new FlightPositionTracker(deps);
      await tracker.flushFlightAutosave();
      expect(deps.saveGame).not.toHaveBeenCalled();
    });
  });

  describe("registerFlightHideAutosave / unregisterFlightHideAutosave", () => {
    it("registers page-hide listeners once and detaches them on unregister", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const tracker = new FlightPositionTracker(makeDeps());

      tracker.registerFlightHideAutosave();
      expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

      // Calling again is a no-op (guarded by the retained handler).
      addSpy.mockClear();
      tracker.registerFlightHideAutosave();
      expect(addSpy).not.toHaveBeenCalled();

      tracker.unregisterFlightHideAutosave();
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("flushes on beforeunload", () => {
      const deps = makeDeps();
      const tracker = new FlightPositionTracker(deps);
      tracker.registerFlightHideAutosave();

      window.dispatchEvent(new Event("beforeunload"));

      expect(deps.saveGame).toHaveBeenCalledWith("auto");
      tracker.unregisterFlightHideAutosave();
    });

    it("flushes on visibilitychange when the document becomes hidden", () => {
      const deps = makeDeps();
      const tracker = new FlightPositionTracker(deps);
      tracker.registerFlightHideAutosave();

      const visibilityStateSpy = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(deps.saveGame).toHaveBeenCalledWith("auto");
      tracker.unregisterFlightHideAutosave();
      visibilityStateSpy.mockRestore();
    });

    it("does not flush on visibilitychange while the document stays visible", () => {
      const deps = makeDeps();
      const tracker = new FlightPositionTracker(deps);
      tracker.registerFlightHideAutosave();

      const visibilityStateSpy = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(deps.saveGame).not.toHaveBeenCalled();
      tracker.unregisterFlightHideAutosave();
      visibilityStateSpy.mockRestore();
    });

    it("detaches the visibilitychange listener on unregister", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const tracker = new FlightPositionTracker(makeDeps());

      tracker.registerFlightHideAutosave();
      expect(addSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      tracker.unregisterFlightHideAutosave();
      expect(removeSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
