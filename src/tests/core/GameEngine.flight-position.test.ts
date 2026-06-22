import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { SceneType, FactionType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { SaveState } from "@/domain/SaveState";

vi.mock("pixi.js", () => ({
  // PlanetRotationFilter (via PlanetSprite → SpaceFlightScene) extends Filter at
  // module load, so the partial mock must expose a constructable Filter.
  Filter: class {},
  Rectangle: class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto", off: vi.fn(), on: vi.fn() },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
    pivot: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
    eventMode: "static",
    cursor: "pointer",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    ellipse: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
    clear: vi.fn(),
    addChild: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    text: "",
    style: {},
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

/**
 * Reload spawn fix (playtest 2026-06-22 #1): the in-flight ship position is now
 * persisted in the save (`flightShipPos`, system-tagged) and restored on load so
 * a reload resumes the ship where it was instead of edge-spawning. Optional +
 * additive — saves made before it lack the field and fall back to edge spawn.
 */
describe("GameEngine flight-position persistence (reload spawn)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      onnxService: new MockOnnxService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
    };
    engine = new GameEngine(diDeps);
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  async function seedGame(systemId: string) {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    engine.player.currentSystemId = systemId;
  }

  describe("saveGame", () => {
    it("persists the live flight position (system-tagged) when in flight", async () => {
      await seedGame("sys-1");
      engine.currentSceneType = SceneType.SPACE_FLIGHT;
      engine.lastFlightShipPos = { x: 123, y: 456 };

      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved!.flightShipPos).toEqual({
        x: 123,
        y: 456,
        systemId: "sys-1",
      });
    });

    it("omits the flight position when none has been recorded", async () => {
      await seedGame("sys-1");
      engine.currentSceneType = SceneType.SPACE_FLIGHT;
      engine.lastFlightShipPos = null;

      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved!.flightShipPos).toBeUndefined();
    });

    it("keeps the last good position across a later autosave that lacks one", async () => {
      await seedGame("sys-1");
      engine.currentSceneType = SceneType.SPACE_FLIGHT;
      engine.lastFlightShipPos = { x: 200, y: 300 };
      await engine.saveGame("auto");

      // A re-entry autosave consumes lastFlightShipPos → null; the persisted
      // position must survive instead of being cleared.
      engine.lastFlightShipPos = null;
      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved!.flightShipPos).toEqual({
        x: 200,
        y: 300,
        systemId: "sys-1",
      });
    });

    it("persists the live free-flight position when the player never left flight", async () => {
      // The headline reload case: warp/take-off into a system, fly around, reload.
      // No scene exit happened (lastFlightShipPos stays null), so the position is
      // captured into liveFlightShipPos on each turn-end and must still persist.
      await seedGame("sys-1");
      engine.currentSceneType = SceneType.SPACE_FLIGHT;
      engine.lastFlightShipPos = null;
      engine.liveFlightShipPos = { x: 777, y: 888 };

      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved!.flightShipPos).toEqual({
        x: 777,
        y: 888,
        systemId: "sys-1",
      });
    });

    it("ignores the live free-flight position when not in flight", async () => {
      // A stale liveFlightShipPos must not leak into a non-flight save (e.g. a
      // PLANET/menu autosave) — those spawns are owned by the landed-planet /
      // edge path, and the field is only valid while SPACE_FLIGHT is active.
      await seedGame("sys-1");
      engine.currentSceneType = SceneType.PLANET;
      engine.lastFlightShipPos = null;
      engine.liveFlightShipPos = { x: 777, y: 888 };

      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved!.flightShipPos).toBeUndefined();
    });
  });

  describe("loadGame", () => {
    function makeSave(
      systemId: string,
      flightShipPos?: { x: number; y: number; systemId: string },
    ): SaveState {
      const player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });
      player.currentSystemId = systemId;
      return new SaveState(
        1,
        engine.galaxy!,
        player,
        [],
        Date.now(),
        SceneType.SPACE_FLIGHT,
        undefined,
        undefined,
        flightShipPos,
      );
    }

    let homeSystemId: string;

    beforeEach(async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      // loadGame resets an unknown currentSystemId to the first system, so the
      // round-trip must use a real system id from the generated galaxy.
      homeSystemId = engine.galaxy.systems[0].id;
    });

    it("restores the ship position as preserveShipPos when the system matches", async () => {
      const save = makeSave(homeSystemId, {
        x: 123,
        y: 456,
        systemId: homeSystemId,
      });
      (diDeps.saveService as MockSaveService).setSave("auto", save);
      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      const result = await engine.loadGame("auto");

      expect(result).toBe(true);
      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
        preserveShipPos: { x: 123, y: 456 },
      });
    });

    it("ignores a flight position saved for a different system (edge spawn)", async () => {
      const save = makeSave(homeSystemId, {
        x: 123,
        y: 456,
        systemId: "other-sys",
      });
      (diDeps.saveService as MockSaveService).setSave("auto", save);
      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      await engine.loadGame("auto");

      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
      });
    });

    it("falls back to the edge spawn for a save without a flight position", async () => {
      const save = makeSave(homeSystemId);
      (diDeps.saveService as MockSaveService).setSave("auto", save);
      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      await engine.loadGame("auto");

      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
      });
    });

    it("does not resume the flight position for a save made while landed", async () => {
      // A PLANET save (ship landed) falls back to SPACE_FLIGHT on load, but the
      // landed-planet spawn (applyReentrySpawn via landedPlanetId) must win over
      // a possibly-stale flightShipPos — landing never refreshes it. So no
      // preserveShipPos even though the system id matches.
      const player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });
      player.currentSystemId = homeSystemId;
      player.landedPlanetId = "planet-1";
      const save = new SaveState(
        1,
        engine.galaxy!,
        player,
        [],
        Date.now(),
        SceneType.PLANET,
        undefined,
        undefined,
        { x: 123, y: 456, systemId: homeSystemId },
      );
      (diDeps.saveService as MockSaveService).setSave("auto", save);
      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      await engine.loadGame("auto");

      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
      });
    });
  });
});
