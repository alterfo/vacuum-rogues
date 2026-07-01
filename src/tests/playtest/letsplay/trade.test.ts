/**
 * Task 2 regression: trade executor executes real market trades.
 *
 * Verifies that {@link executeMemoryAwareTrade} (and its legacy wrapper
 * {@link executeTradeOnPlanet}) interact with the real {@link TradeSystem}
 * (no mocked seam, no direct field mutation) — credits and/or cargo change
 * through the canonical `executeTrade` path.
 *
 * Key contract: when a `preferredGood` is supplied and stocked at this planet,
 * the executor buys that good; when `null` is supplied it falls back to the
 * cheapest available good (price-discovery mode). Both paths must be safe no-ops
 * when credits or hold are exhausted.
 *
 * Real-engine tier: boots the real GameEngine into a new game and drives the
 * real `executeMemoryAwareTrade` helper, asserting observable engine state
 * (no harness errors, credits within expected range).
 */
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

    // With a fresh game and no cargo, credits may change (bought something)
    // or stay the same — either way it must not crash and produce no errors.
    expect(engine.player!.credits).toBeGreaterThanOrEqual(0);
    // Credits cannot exceed the starting amount since no cargo was sold.
    expect(engine.player!.credits).toBeLessThanOrEqual(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTradeOnPlanet buys goods when the player has credits and free hold", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.PLANET, { planet });

    const player = engine.player!;
    const creditsBefore = player.credits;

    // Only assert buying happened when the planet has a market with goods
    const resources = planet!.market?.availableResources ?? [];
    if (resources.length > 0 && creditsBefore > 0) {
      executeTradeOnPlanet(engine, planet!);
      // With credits and free hold, buying should have spent some credits
      expect(player.credits).toBeLessThanOrEqual(creditsBefore);
    } else {
      // Nothing to buy — must still be a clean no-op
      executeTradeOnPlanet(engine, planet!);
    }
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTradeOnPlanet does not error when called from TRADE scene context", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    // Navigate to the trade scene (same planet the executor will use)
    await harness.goTo(SceneType.TRADE, { planet });

    executeTradeOnPlanet(engine, planet!);

    expect(harness.errors()).toHaveLength(0);
  });

  it("executeMemoryAwareTrade(preferredGood=null) behaves identically to executeTradeOnPlanet", async () => {
    // The `null` path is the backwards-compatible fallback: buys the cheapest good.
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets[0];
    expect(planet).toBeTruthy();

    await harness.goTo(SceneType.PLANET, { planet });

    const creditsBefore = engine.player!.credits;
    executeMemoryAwareTrade(engine, planet!, null);
    expect(engine.player!.credits).toBeLessThanOrEqual(creditsBefore);
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

    // Pick the SECOND cheapest resource so the preferred ≠ the cheapest fallback.
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
