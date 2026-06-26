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

/**
 * Reload-position cluster (red) —
 * `docs/plans/20260625-combat-orbit-and-flight-persistence-fix.md`.
 *
 * Playtest bug: free flight has no continuous autosave. `liveFlightShipPos` is
 * captured only at a discrete route-turn end (`endFlightTurn`); between turns,
 * and when the page is hidden/reloaded mid-flight (no turn completed), nothing
 * persists the *live* position — so a reload restores the stale system-entry
 * (edge) position instead of where the ship actually is.
 *
 * Task 4 added a continuous live-position capture (`recordLiveFlightPos`) plus a
 * page-hide flush (`flushFlightAutosave`) so a reload resumes the live position.
 * These tests assert that capability and are GREEN now that Task 4 wired it in.
 * They probe via casts (the seams are optional on the cast type) so the file
 * stays decoupled from the engine surface.
 */
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

  /** Continuous live-position capture seam Task 4 adds (probed via cast). */
  function recordLive(x: number, y: number): void {
    const rec = (
      engine as unknown as {
        recordLiveFlightPos?: (x: number, y: number) => void;
      }
    ).recordLiveFlightPos;
    rec?.call(engine, x, y);
  }

  /** Page-hide flush seam Task 4 adds (probed via cast). */
  async function flushOnHide(): Promise<void> {
    const flush = (
      engine as unknown as { flushFlightAutosave?: () => Promise<void> }
    ).flushFlightAutosave;
    await flush?.call(engine);
  }

  // GREEN since Task 4 wired `recordLiveFlightPos` / `flushFlightAutosave`
  // (was a Task-1 `it.fails` reproduction; the seams now exist so the assertions
  // pass and these run as plain `it`).
  it("continuous capture: recordLiveFlightPos folds the live position into the next save", async () => {
    await seedGame("sys-1");
    engine.currentSceneType = SceneType.SPACE_FLIGHT;

    // Ship enters at the edge; that becomes the last persisted position.
    recordLive(40, 40);
    await engine.saveGame("auto");

    // Player flies deep into the system — no route-turn ends, but the live
    // position must keep tracking the ship.
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

    // System entry autosave at the edge.
    recordLive(40, 40);
    await engine.saveGame("auto");
    expect((await diDeps.saveService.read("auto"))!.flightShipPos).toEqual({
      x: 40,
      y: 40,
      systemId: "sys-1",
    });

    // Fly into the system, then the tab is hidden / reloaded WITHOUT a turn-end.
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
    // Not in flight — a stale live capture must not leak into a non-flight save.
    engine.currentSceneType = SceneType.PLANET;
    recordLive(620, 410);

    await flushOnHide();

    const saved = await diDeps.saveService.read("auto");
    // No flight save should have been written by the hide flush.
    expect(saved?.flightShipPos).toBeUndefined();
  });
});
