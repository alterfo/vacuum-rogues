import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { FactionType } from "@/types";
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
 * «Новая игра» must produce a genuinely fresh game even when one was already in
 * progress this session. The single full-reset point is
 * `generateDefaultGameState`; before this fix it cleared player/loadout/galaxy +
 * win/death guards but left quests, the banking ledger and the persisted flight
 * position from the prior game.
 */
describe("GameEngine — new-game reset (generateDefaultGameState)", () => {
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

  it("clears player, loadout, quests, banking ledger and flight position", async () => {
    // Seed an in-progress game.
    engine.galaxy = await diDeps.galaxyService.generate("prior", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    engine.lastFlightShipPos = { x: 123, y: 456 };
    (engine as unknown as { flightShipPos: unknown }).flightShipPos = {
      x: 7,
      y: 8,
      systemId: "sys-1",
    };

    const restoreSpy = vi.spyOn(engine.questManager, "restoreState");
    const resetLedgerSpy = vi.spyOn(engine.bankingService, "resetLedger");

    await (
      engine as unknown as { generateDefaultGameState: () => Promise<void> }
    ).generateDefaultGameState();

    // Player + loadout wiped.
    expect(engine.player).toBeNull();
    expect(
      (engine as unknown as { playerLoadout: unknown }).playerLoadout,
    ).toBeNull();
    // Quests cleared (active/completed/pending → empty).
    expect(restoreSpy).toHaveBeenCalledWith([], []);
    // Banking ledger reset to a fresh seeded book.
    expect(resetLedgerSpy).toHaveBeenCalled();
    // Persisted + transient flight position cleared so the new game never resumes
    // the prior ship location.
    expect(engine.lastFlightShipPos).toBeNull();
    expect(
      (engine as unknown as { flightShipPos: unknown }).flightShipPos,
    ).toBeNull();
    // A fresh galaxy was generated.
    expect(engine.galaxy).not.toBeNull();
  });
});
