import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { StarType, ResourceType, PlanetType } from "@/types";
import { Faction } from "@/types/faction";

// GameEngine pulls in pixi.js at module load; stub it so the headless test env
// never touches WebGL (mirrors GameEngine.market-rehydration.test.ts).
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
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn(),
    addChild: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    text: "",
    style: {},
    destroy: vi.fn(),
  })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

/**
 * Build a planet whose only market resource is METALS, with the dynamic price
 * multiplier seeded so a deliberate cross-system spread exists. The drift layer
 * dominates the deterministic per-planet factor ([0.7,1.3)), so `pmMetals` alone
 * decides which planet is cheap vs dear.
 */
function makePlanet(id: string, pmMetals: number): Planet {
  const market = new Market([ResourceType.METALS], [1], [1]);
  market.priceMultipliers = [pmMetals];
  return new Planet(
    id,
    `Planet ${id}`,
    PlanetType.TERRESTRIAL,
    600,
    market,
    [],
    [],
    true,
    0,
    1_000_000,
  );
}

function makeSystem(id: string, planets: Planet[]): StarSystem {
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    planets,
    Faction.INDEPENDENT,
    [],
  );
}

function connect(a: StarSystem, b: StarSystem): void {
  a.connections.push(new WarpPath(a.id, b.id, 2));
  b.connections.push(new WarpPath(b.id, a.id, 2));
}

function makeEngine(): GameEngine {
  const diDeps: GameEngineDIDependencies = {
    saveService: new MockSaveService(),
    galaxyService: new MockGalaxyService(),
    playerService: new MockPlayerService(),
    onnxService: new MockOnnxService(),
    exceptionHandler: new MockExceptionHandler(),
    qualityProfile: new AdaptiveQualityProfile(),
    questService: new MockQuestService(),
  };
  return new GameEngine(diDeps);
}

describe("GameEngine.advanceGalaxyDay — trade-route rumors", () => {
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = makeEngine();
    // Don't let the (improbable) game-over path try to swap scenes.
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("publishes a TRADE_OPPORTUNITY rumor when a seeded cross-system spread exists", () => {
    // Cheap METALS in S1, dear METALS in S2 → a wide buy-low/sell-high route.
    const cheap = makeSystem("S1", [makePlanet("S1p", 0.4)]);
    const dear = makeSystem("S2", [makePlanet("S2p", 2.5)]);
    connect(cheap, dear);
    const galaxy = new Galaxy("g_rumor", [cheap, dear], new Overmind(), [], []);
    engine.galaxy = galaxy;

    engine.advanceGalaxyDay();

    const tradeNews = galaxy.newsFeed.filter(
      (n) => n.type === "TRADE_OPPORTUNITY",
    );
    expect(tradeNews.length).toBeGreaterThanOrEqual(1);

    const rumors = galaxy.activeRumors;
    expect(rumors.length).toBeGreaterThanOrEqual(1);
    const metalsRumor = rumors.find((r) => r.resource === ResourceType.METALS);
    expect(metalsRumor).toBeDefined();
    expect(metalsRumor!.fromSystemId).toBe("S1");
    expect(metalsRumor!.toSystemId).toBe("S2");
    expect(metalsRumor!.marginPct).toBeGreaterThan(
      // Comfortably above the open threshold; the seeded ~6× spread can't be
      // erased by one day of ≤8% drift or the [0.7,1.3) per-planet factor.
      25,
    );
  });

  it("does not crash and opens no rumors for a galaxy with fewer than two market systems", () => {
    const only = makeSystem("S1", [makePlanet("S1p", 0.4)]);
    // A second system with no planets/markets → still only one market-bearing system.
    const barren = makeSystem("S2", []);
    connect(only, barren);
    const galaxy = new Galaxy(
      "g_single",
      [only, barren],
      new Overmind(),
      [],
      [],
    );
    engine.galaxy = galaxy;

    expect(() => engine.advanceGalaxyDay()).not.toThrow();
    expect(
      galaxy.newsFeed.filter((n) => n.type === "TRADE_OPPORTUNITY"),
    ).toHaveLength(0);
    expect(galaxy.activeRumors).toHaveLength(0);
  });

  it("expires the rumor once the spread closes across days", () => {
    // Both planets share a planet id so the deterministic per-planet factor
    // cancels — the dynamic multiplier alone decides the spread, so collapsing
    // both to 1.0 reliably drives the margin to exactly 0 (no residual gap).
    const cheap = makeSystem("S1", [makePlanet("Pmet", 0.4)]);
    const dear = makeSystem("S2", [makePlanet("Pmet", 2.5)]);
    connect(cheap, dear);
    const galaxy = new Galaxy("g_close", [cheap, dear], new Overmind(), [], []);
    engine.galaxy = galaxy;

    engine.advanceGalaxyDay();
    expect(galaxy.activeRumors.length).toBeGreaterThanOrEqual(1);

    // Collapse the spread: both planets back to neutral pricing → margin 0.
    cheap.planets[0].market.priceMultipliers[0] = 1.0;
    dear.planets[0].market.priceMultipliers[0] = 1.0;
    engine.advanceGalaxyDay();

    expect(
      galaxy.activeRumors.find((r) => r.resource === ResourceType.METALS),
    ).toBeUndefined();
    expect(
      galaxy.newsFeed.some((n) => n.description.includes("акция закончилась")),
    ).toBe(true);
  });
});
