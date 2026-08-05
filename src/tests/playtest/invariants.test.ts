import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import type { StarSystem } from "@/domain/StarSystem";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function systemsWithPlanets(harness: RealEngineHarness): StarSystem[] {
  return harness.galaxy()!.systems.filter((s) => s.planets.length > 0);
}

function forwardActionAvailable(harness: RealEngineHarness): boolean {
  const t = harness.currentSceneType();
  if (t === SceneType.GAME_OVER || t === SceneType.WIN_SCREEN) return false;
  const player = harness.player();
  const galaxy = harness.galaxy();
  if (!player || !galaxy) return false;
  const canWarp = galaxy.systems.length > 1; // a star map with somewhere to go
  const here = galaxy.systems.find((s) => s.id === player.currentSystemId);
  const canLand = !!here && here.planets.length > 0;
  return canWarp || canLand;
}

describe("Error-invariant + always-actionable net (real engine)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("drives turn → land → every reachable scene with zero errors and no dead-ends", async () => {
    await harness.newGame();
    const sys = systemsWithPlanets(harness)[0];
    expect(sys).toBeDefined();
    const planet = sys.planets[0];
    harness.player()!.currentSystemId = sys.id;

    const station = new Station(
      "playtest-station",
      "Орбитальная станция",
      StationType.TRADE_POST,
      Faction.INDEPENDENT,
      400,
      0,
    );

    const reachable: Array<{
      type: SceneType;
      label: string;
      context: () => object;
    }> = [
      { type: SceneType.STAR_MAP, label: "star map", context: () => ({}) },
      { type: SceneType.PLANET, label: "planet", context: () => ({ planet }) },
      { type: SceneType.TRADE, label: "market", context: () => ({ planet }) },
      {
        type: SceneType.EQUIPMENT_SHOP,
        label: "shipyard",
        context: () => ({ planet }),
      },
      {
        type: SceneType.GOVERNMENT,
        label: "government",
        context: () => ({ planet }),
      },
      {
        type: SceneType.INFO_CENTER,
        label: "info centre",
        context: () => ({ planet }),
      },
      { type: SceneType.BANK, label: "bank", context: () => ({ planet }) },
      {
        type: SceneType.STATION,
        label: "station",
        context: () => ({ station }),
      },
      { type: SceneType.INVENTORY, label: "inventory", context: () => ({}) },
    ];

    harness.tick(16);
    harness.tick(16);
    harness.engine.advanceGalaxyDay();
    expect(harness.errors().map((e) => e.message)).toEqual([]);
    expect(forwardActionAvailable(harness)).toBe(true);

    await harness.goTo(SceneType.PLANET, { planet });
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    for (const scene of reachable) {
      await harness.goTo(scene.type, scene.context());
      expect(harness.currentSceneType(), `${scene.label} did not open`).toBe(
        scene.type,
      );
      expect(
        harness.currentScene(),
        `${scene.label} scene is null`,
      ).not.toBeNull();
      harness.tick(16); // a frame on the opened scene must not throw
      expect(
        harness.errors().map((e) => e.message),
        `errors after opening ${scene.label}`,
      ).toEqual([]);

      await harness.goTo(SceneType.SPACE_FLIGHT);
      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
      expect(
        harness.player(),
        `${scene.label} stranded the player`,
      ).not.toBeNull();
      expect(
        forwardActionAvailable(harness),
        `dead-end after ${scene.label}`,
      ).toBe(true);
    }

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("never leaves the flight hub without an available action across several turns", async () => {
    await harness.newGame();

    for (let day = 0; day < 5; day++) {
      expect(forwardActionAvailable(harness), `dead-end on day ${day}`).toBe(
        true,
      );
      harness.engine.advanceGalaxyDay();
      harness.tick(16);
    }

    expect(forwardActionAvailable(harness)).toBe(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
