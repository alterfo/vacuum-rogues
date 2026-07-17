/**
 * `SaveState.autopilotEngaged` — the optional additive field persisting whether
 * the DEV-only live autopilot was engaged at save time
 * (plan 20260713-autosave-autopilot-resume, Task 3).
 *
 * Three angles:
 *   1. `SaveState` serialize/deserialize round-trip (true / false / absent).
 *   2. `SaveStateSchema` accepts a boolean or absence, rejects a non-boolean —
 *      old saves (no field) must still validate (no migration, no version bump).
 *   3. `GameEngine.saveGame` reads the injected `IAutopilotStateProvider` and
 *      writes its current engagement flag into the built `SaveState`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveState } from "@/domain/SaveState";
import { SaveStateSchema } from "@/validation/schemas";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { DIContainer } from "@/core/DIContainer";
import type { IAutopilotStateProvider } from "@/core/ports";
import { FactionType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";

// Broad PixiJS mock — GameEngine transitively pulls in SceneFactory/scenes.
vi.mock("pixi.js", () => ({
  Filter: class {},
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto" },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
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

describe("SaveState.autopilotEngaged round-trip", () => {
  // serialize()/deserialize() only JSON-stringify these — plain stubs suffice.
  const galaxy = {} as Galaxy;
  const player = {} as Player;

  function roundTrip(autopilotEngaged?: boolean): SaveState {
    const state = new SaveState(
      1,
      galaxy,
      player,
      [],
      123,
      undefined, // currentSceneType
      undefined, // loadout
      undefined, // banking
      undefined, // flightShipPos
      undefined, // campaignPeakPower
      undefined, // loadoutPresets
      autopilotEngaged,
    );
    return SaveState.deserialize(state.serialize());
  }

  it("preserves `true`", () => {
    expect(roundTrip(true).autopilotEngaged).toBe(true);
  });

  it("preserves `false`", () => {
    expect(roundTrip(false).autopilotEngaged).toBe(false);
  });

  it("stays absent when never set (old-save default)", () => {
    expect(roundTrip(undefined).autopilotEngaged).toBeUndefined();
  });
});

describe("SaveStateSchema — autopilotEngaged is optional additive", () => {
  const field = SaveStateSchema.shape.autopilotEngaged;

  it("accepts a boolean", () => {
    expect(field.safeParse(true).success).toBe(true);
    expect(field.safeParse(false).success).toBe(true);
  });

  it("accepts absence (old saves untouched, no migration)", () => {
    expect(field.safeParse(undefined).success).toBe(true);
  });

  it("rejects a non-boolean", () => {
    expect(field.safeParse("yes").success).toBe(false);
    expect(field.safeParse(1).success).toBe(false);
    expect(field.safeParse(null).success).toBe(false);
  });
});

describe("GameEngine.saveGame persists the autopilot engagement flag", () => {
  let diDeps: GameEngineDIDependencies;

  const stubProvider = (engaged: boolean): IAutopilotStateProvider => ({
    isEngaged: () => engaged,
    resume: () => {},
  });

  beforeEach(() => {
    DIContainer.reset();
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  async function seedGame(engine: GameEngine): Promise<void> {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
  }

  it("writes `true` when the provider reports engaged", async () => {
    const engine = new GameEngine({
      ...diDeps,
      autopilotStateProvider: stubProvider(true),
    });
    await seedGame(engine);

    await engine.saveGame("auto");

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.autopilotEngaged).toBe(true);
  });

  it("writes `false` when the provider reports not engaged", async () => {
    const engine = new GameEngine({
      ...diDeps,
      autopilotStateProvider: stubProvider(false),
    });
    await seedGame(engine);

    await engine.saveGame("auto");

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.autopilotEngaged).toBe(false);
  });

  it("writes `false` under the default no-op provider (production/tests)", async () => {
    const engine = new GameEngine(diDeps);
    await seedGame(engine);

    await engine.saveGame("auto");

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.autopilotEngaged).toBe(false);
  });
});
