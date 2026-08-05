import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
}));

import { launchDenialReason } from "@/systems/equipment/launchDenial";
import { PlanetScene } from "@/presentation/PlanetScene";
import { StationScene } from "@/presentation/StationScene";

describe("launchDenialReason (pure resolver)", () => {
  it("returns null when the ship can take off", () => {
    expect(
      launchDenialReason({ canTakeOff: true, speed: 0.2, fuelCapacity: 100 }),
    ).toBeNull();
  });

  it("blames the engine when speed is 0 (no engine)", () => {
    expect(
      launchDenialReason({ canTakeOff: false, speed: 0, fuelCapacity: 100 }),
    ).toBe("engine");
  });

  it("blames fuel when an engine is present but no fuel tank", () => {
    expect(
      launchDenialReason({ canTakeOff: false, speed: 0.2, fuelCapacity: 0 }),
    ).toBe("fuel");
  });

  it("prefers the engine reason when both are missing", () => {
    expect(
      launchDenialReason({ canTakeOff: false, speed: 0, fuelCapacity: 0 }),
    ).toBe("engine");
  });
});

function stats(reason: "engine" | "fuel") {
  return reason === "engine"
    ? { canTakeOff: false, speed: 0, fuelCapacity: 100 }
    : { canTakeOff: false, speed: 0.2, fuelCapacity: 0 };
}

describe("PlanetScene.takeOff denial message", () => {
  function makeScene(reason: "engine" | "fuel") {
    const scene = Object.create(PlanetScene.prototype) as PlanetScene;
    const transitionTo = vi.fn().mockResolvedValue(undefined);
    const showMessage = vi.fn();
    const fields = scene as unknown as Record<string, unknown>;
    fields.showMessage = showMessage;
    fields.gameEngine = {
      transitionTo,
      saveGame: vi.fn().mockResolvedValue(undefined),
      playerLoadout: { derivedStats: () => stats(reason) },
    };
    fields.planet = { id: "planet-1" };
    return {
      takeOff: () =>
        (scene as unknown as { takeOff(): Promise<void> }).takeOff(),
      transitionTo,
      showMessage,
    };
  }

  it("names the missing engine on take-off", async () => {
    const { takeOff, transitionTo, showMessage } = makeScene("engine");
    await takeOff();
    expect(transitionTo).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(
      expect.stringContaining("Нет двигателя"),
      expect.anything(),
    );
  });

  it("names the missing fuel tank on take-off", async () => {
    const { takeOff, transitionTo, showMessage } = makeScene("fuel");
    await takeOff();
    expect(transitionTo).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(
      expect.stringContaining("топливного бака"),
      expect.anything(),
    );
  });
});

describe("StationScene.undock denial message", () => {
  function makeScene(reason: "engine" | "fuel") {
    const scene = Object.create(StationScene.prototype) as StationScene;
    const transitionTo = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const fields = scene as unknown as Record<string, unknown>;
    fields.showToast = showToast;
    fields.gameEngine = {
      transitionTo,
      playerLoadout: { derivedStats: () => stats(reason) },
    };
    fields.station = { id: "station-1" };
    return {
      undock: () => (scene as unknown as { undock(): Promise<void> }).undock(),
      transitionTo,
      showToast,
    };
  }

  it("names the missing engine on undock", async () => {
    const { undock, transitionTo, showToast } = makeScene("engine");
    await undock();
    expect(transitionTo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Нет двигателя"),
      expect.anything(),
    );
  });

  it("names the missing fuel tank on undock", async () => {
    const { undock, transitionTo, showToast } = makeScene("fuel");
    await undock();
    expect(transitionTo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("топливного бака"),
      expect.anything(),
    );
  });
});
