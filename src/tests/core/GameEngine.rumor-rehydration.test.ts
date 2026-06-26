import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { SceneType, FactionType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { SaveState } from "@/domain/SaveState";

vi.mock("pixi.js", () => ({
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
    text: "",
    style: {},
    eventMode: "none",
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

/**
 * Regression: SaveManager returns plain JSON (the Zod `.default([])` is applied
 * only to a discarded validated copy), and reparenting via setPrototypeOf does
 * not run the `activeRumors = []` class field initializer. A save created before
 * the trade-rumor feature therefore loads with `galaxy.activeRumors === undefined`,
 * which throws in getActiveRumors()/updateRumors() on the first daily tick.
 * rehydrateLoadedState must coerce the missing field back to an empty array.
 */
describe("GameEngine — trade-rumor rehydration on load", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
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

  it("restores activeRumors to [] and survives a daily tick for a pre-feature save", async () => {
    const galaxy = await diDeps.galaxyService.generate("test", 6);
    const player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });

    // JSON round-trip strips prototypes (like SaveManager); explicitly drop the
    // field so the save looks exactly like a pre-feature one that never had it.
    const plainGalaxy = JSON.parse(JSON.stringify(galaxy));
    delete plainGalaxy.activeRumors;
    const plainPlayer = JSON.parse(JSON.stringify(player));

    const save = new SaveState(
      1,
      plainGalaxy,
      plainPlayer,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    const ok = await engine.loadGame("auto");
    expect(ok).toBe(true);

    // The guard restored the field, so the live store is queryable...
    expect(Array.isArray(engine.galaxy!.activeRumors)).toBe(true);
    expect(() => engine.galaxy!.getActiveRumors()).not.toThrow();

    // ...and the first daily tick (which iterates activeRumors via updateRumors)
    // does not crash.
    expect(() => engine.advanceGalaxyDay()).not.toThrow();
  });
});
