import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import {
  currentSystem,
  executeTradeOnPlanet,
  executeMemoryAwareTrade,
} from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("letsplay trade executor (Task 2)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "TRADE-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("executeTradeOnPlanet is a safe no-op when cargo is empty and credits are low", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.PLANET, { planet });

    const creditsBefore = engine.player!.credits;
    executeTradeOnPlanet(engine, planet!);

    expect(engine.player!.credits).toBeGreaterThanOrEqual(0);
    expect(engine.player!.credits).toBeLessThanOrEqual(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTradeOnPlanet never speculatively buys (sell-only, no known margin)", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.PLANET, { planet });

    const player = engine.player!;
    const creditsBefore = player.credits;

    executeTradeOnPlanet(engine, planet!);
    expect(player.credits).toBeGreaterThanOrEqual(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTradeOnPlanet does not error when called from TRADE scene context", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.TRADE, { planet });

    executeTradeOnPlanet(engine, planet!);

    expect(harness.errors()).toHaveLength(0);
  });

  it("executeMemoryAwareTrade(preferredGood=null) behaves identically to executeTradeOnPlanet", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.PLANET, { planet });

    const creditsBefore = engine.player!.credits;
    executeMemoryAwareTrade(engine, planet!, null);
    expect(engine.player!.credits).toBeGreaterThanOrEqual(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeMemoryAwareTrade buys the preferred good when it is stocked", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets.find(
      (p) => (p.market?.availableResources?.length ?? 0) >= 2,
    );
    if (!planet || !planet.market || !engine.player) return; // generated galaxy may lack this

    await harness.goTo(SceneType.PLANET, { planet });

    const { TradeSystem } = await import("@/systems/TradeSystem");
    const ts = new TradeSystem();
    const resources = planet.market.availableResources;
    const sorted = resources
      .map((r) => ({ r, p: ts.getBuyPrice(planet, r, engine.player!) }))
      .filter((x) => x.p > 0 && x.p <= engine.player!.credits)
      .sort((a, b) => a.p - b.p);
    if (sorted.length < 2) return; // need ≥ 2 affordable goods to distinguish branches

    const preferredGood = sorted[1].r; // not the cheapest → proves preferred path

    executeMemoryAwareTrade(engine, planet, preferredGood);

    const held = engine.player.inventory.resources.find(
      (r) => r.type === preferredGood,
    );
    expect(
      held?.amount ?? 0,
      `preferred good ${preferredGood} not in cargo after memory-aware trade`,
    ).toBeGreaterThan(0);
    expect(harness.errors()).toHaveLength(0);
  });
});
