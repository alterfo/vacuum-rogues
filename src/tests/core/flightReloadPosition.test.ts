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

describe("flight reload position — live in-flight persistence (Task 4)", () => {
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

  async function seedGame(systemId: string) {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    engine.player.currentSystemId = systemId;
  }

  function recordLive(x: number, y: number): void {
    const rec = (
      engine as unknown as {
        recordLiveFlightPos?: (x: number, y: number) => void;
      }
    ).recordLiveFlightPos;
    rec?.call(engine, x, y);
  }

  async function flushOnHide(): Promise<void> {
    const flush = (
      engine as unknown as { flushFlightAutosave?: () => Promise<void> }
    ).flushFlightAutosave;
    await flush?.call(engine);
  }

  it("continuous capture: recordLiveFlightPos folds the live position into the next save", async () => {
    await seedGame("sys-1");
    engine.currentSceneType = SceneType.SPACE_FLIGHT;

    recordLive(40, 40);
    await engine.saveGame("auto");

    recordLive(620, 410);
    await engine.saveGame("auto");

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.flightShipPos).toEqual({
      x: 620,
      y: 410,
      systemId: "sys-1",
    });
  });

  it("page-hide flush persists the live mid-flight position (reload resumes there, not the edge)", async () => {
    await seedGame("sys-1");
    engine.currentSceneType = SceneType.SPACE_FLIGHT;

    recordLive(40, 40);
    await engine.saveGame("auto");
    expect((await diDeps.saveService.read("auto"))!.flightShipPos).toEqual({
      x: 40,
      y: 40,
      systemId: "sys-1",
    });

    recordLive(620, 410);
    await flushOnHide();

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.flightShipPos).toEqual({
      x: 620,
      y: 410,
      systemId: "sys-1",
    });
  });

  it("page-hide flush is inert outside flight (a landed/menu save is not overwritten)", async () => {
    await seedGame("sys-1");
    engine.currentSceneType = SceneType.PLANET;
    recordLive(620, 410);

    await flushOnHide();

    const saved = await diDeps.saveService.read("auto");
    expect(saved?.flightShipPos).toBeUndefined();
  });
});
