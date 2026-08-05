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
import { npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import type { Galaxy } from "@/domain/Galaxy";
import type { GameScene } from "@/presentation/GameScene";

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

describe("star-map round-trip leaves the simulation untouched (Task 3)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  const stubScene = (): GameScene =>
    ({
      initialize: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn(),
    }) as unknown as GameScene;

  function makeRenderer(): import("@/presentation/Renderer").Renderer {
    return {
      app: {
        screen: { width: 800, height: 600 },
        canvas: document.createElement("canvas"),
        renderer: { type: "webgl", resize: vi.fn() },
        ticker: { start: vi.fn() },
        stage: {
          eventMode: "auto",
          addChild: vi.fn(),
          off: vi.fn(),
          on: vi.fn(),
        },
      },
      gameLayer: { addChild: vi.fn(), children: [], removeChild: vi.fn() },
      uiLayer: { addChild: vi.fn(), children: [], removeChild: vi.fn() },
      stage: { addChild: vi.fn(), removeChild: vi.fn() },
      clearGameLayer: vi.fn(),
      clearUILayer: vi.fn(),
    } as unknown as import("@/presentation/Renderer").Renderer;
  }

  function populatedSystemId(galaxy: Galaxy): string {
    for (const sys of galaxy.systems) {
      if (npcsPresentInSystem(galaxy, sys.id).length > 0) return sys.id;
    }
    throw new Error("no populated system in generated galaxy");
  }

  function snapshot(galaxy: Galaxy, systemId: string) {
    return npcsPresentInSystem(galaxy, systemId)
      .map((n) => ({
        id: n.id,
        role: n.role,
        systemId: n.currentSystemId,
        worldX: n.worldX,
        worldY: n.worldY,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  beforeEach(async () => {
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
    engine.renderer = makeRenderer();

    engine.galaxy = await diDeps.galaxyService.generate("roundtrip-seed", 8);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });

    const sysId = populatedSystemId(engine.galaxy);
    engine.player.currentSystemId = sysId;

    for (const npc of npcsPresentInSystem(engine.galaxy, sysId)) {
      const off = deterministicNpcOffset(engine.galaxy.id, npc.id);
      npc.setWorldPosition(400 + off.x, 300 + off.y);
    }
  });

  afterEach(() => {
    engine.currentScene?.destroy();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("does not tick NPCs or change ship composition/positions on a no-jump round-trip", async () => {
    const sysId = engine.player!.currentSystemId;
    const galaxy = engine.galaxy!;

    vi.spyOn(
      (engine as unknown as { sceneFactory: { createScene: unknown } })
        .sceneFactory as { createScene: (...a: unknown[]) => GameScene },
      "createScene",
    ).mockImplementation(() => stubScene());

    const tickSpy = vi.spyOn(engine.npc, "tick");
    const daySpy = vi.spyOn(engine, "advanceGalaxyDay");

    const before = snapshot(galaxy, sysId);
    const daysBefore = galaxy.gameDays;

    await engine.transitionTo(SceneType.STAR_MAP, { gameEngine: engine });
    await engine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: engine });

    expect(tickSpy).not.toHaveBeenCalled();
    expect(daySpy).not.toHaveBeenCalled();
    expect(galaxy.gameDays).toBe(daysBefore);
    expect(snapshot(galaxy, sysId)).toEqual(before);
  });

  it("a real day-advance DOES tick the simulation (the jump/move path)", async () => {
    const galaxy = engine.galaxy!;

    vi.spyOn(
      (engine as unknown as { sceneFactory: { createScene: unknown } })
        .sceneFactory as { createScene: (...a: unknown[]) => GameScene },
      "createScene",
    ).mockImplementation(() => stubScene());

    const tickSpy = vi.spyOn(engine.npc, "tick");
    const daysBefore = galaxy.gameDays;

    engine.advanceGalaxyDay();

    expect(tickSpy).toHaveBeenCalledTimes(1);
    expect(galaxy.gameDays).toBe(daysBefore + 1);
  });
});
