/**
 * Task 6 regression: the LIVE autopilot's 7 previously-no-op verbs
 * (repair/buyGear/upgradeHull/buyModule/takeLoan/repayLoan/sellCargo) now
 * drive their real executor through `createLiveSceneController`, exactly as
 * the headless `PlayerAgent` applier already does (`engineQueries`/
 * `equipmentQueries`/`bankingQueries` — see `newActions.test.ts`/
 * `repairQuest.test.ts` for the executors' own real-engine coverage). This
 * file exercises the LIVE wiring itself (previously a safe no-op comment),
 * not the executors in isolation.
 *
 * Also covers the live buy-accounting skew fix: `openTrade` executes the
 * trade then transitions straight to SPACE_FLIGHT (never back to PLANET, to
 * avoid a stuck TRADE-scene loop), so the inventory delta is only visible on
 * the *next* `updateMemory` fold — by which point `obs.currentPlanet` is
 * already null. `AgentMemory.lastCurrentPlanetId` lets that fold still
 * recover the real buy price from the price book instead of defaulting to 0.
 * Since the 20260703 plan's no-speculation fix, `executeTradeOnPlanet`
 * (`preferredGood=null`) is sell-only, so this test drives
 * `executeMemoryAwareTrade` directly with an explicit preferred good to still
 * exercise a real buy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GameEngine } from "@/systems/GameEngine";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType, StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import { TradeSystem } from "@/systems/TradeSystem";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { createLiveSceneController } from "./installAutopilotHook";
import { currentSystem, executeMemoryAwareTrade } from "./engineQueries";
import {
  bestAffordableGear,
  bestAffordableHull,
  cheapestMicromodule,
  canArmUp,
} from "./equipmentQueries";
import {
  canTakeLoan,
  playerLoanBalance,
  executeTakeLoan,
} from "./bankingQueries";
import { createMemory, updateMemory } from "./AgentMemory";
import { observe } from "./observe";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("createLiveSceneController — the 7 wired economy heads (Task 6)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "LIVE-ECON-HEADS-TEST" });
    await harness.newGame();

    // Guarantee a shoppable system: a CRAFT_CENTER station, plus a tech level
    // high enough to unlock hull listings (mirrors newActions.test.ts).
    const sys = currentSystem(harness.engine)!;
    sys.techLevel = 5;
    sys.stations.push(
      new Station(
        "craft-1",
        "Крафт-центр",
        StationType.CRAFT_CENTER,
        Faction.INDEPENDENT,
        100,
        0,
      ),
    );
    adjustPlayerCredits(
      harness.engine.bank,
      harness.engine.player!,
      500000,
      GL_COUNTERPARTY.REWARDS,
      "test seed",
    );
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("repair() restores hull and spends credits via the real executor", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    const station = sys.stations[0];
    await harness.goTo(SceneType.STATION, { station });

    const player = engine.player!;
    player.ship.hullHP = Math.max(1, player.ship.maxHull - 50);
    const hullBefore = player.ship.hullHP;
    const creditsBefore = player.credits;

    createLiveSceneController(engine).repair();

    expect(player.ship.hullHP).toBeGreaterThan(hullBefore);
    expect(player.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("buyGear() acquires owned gear and spends the listing price", () => {
    const engine = harness.engine;
    const listing = bestAffordableGear(engine);
    expect(listing).toBeTruthy();
    const player = engine.player!;
    const creditsBefore = player.credits;
    const ownedBefore = player.inventory.ownedGearIds.length;

    createLiveSceneController(engine).buyGear();

    expect(player.inventory.ownedGearIds).toContain(listing!.gear.id);
    expect(player.inventory.ownedGearIds.length).toBe(ownedBefore + 1);
    expect(player.credits).toBe(creditsBefore - listing!.price);
    expect(harness.errors()).toHaveLength(0);
  });

  it("armUp() fits a stronger gun, raising installed weapon damage", () => {
    const engine = harness.engine;
    const loadout = engine.playerLoadout!;
    const before = loadout.derivedStats().weaponDamage;
    expect(canArmUp(engine)).toBe(true);

    createLiveSceneController(engine).armUp();

    expect(loadout.derivedStats().weaponDamage).toBeGreaterThan(before);
    expect(harness.errors()).toHaveLength(0);
  });

  it("upgradeHull() trades in the fitted hull for the priciest affordable one", () => {
    const engine = harness.engine;
    const loadout = engine.playerLoadout!;
    const oldHullId = loadout.hull.id;
    const listing = bestAffordableHull(engine);
    expect(listing).toBeTruthy();

    createLiveSceneController(engine).upgradeHull();

    expect(loadout.hull.id).toBe(listing!.gear.id);
    expect(loadout.hull.id).not.toBe(oldHullId);
    expect(harness.errors()).toHaveLength(0);
  });

  it("buyModule() buys an unowned micromodule", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const mm = cheapestMicromodule(engine);
    expect(mm).toBeTruthy();
    const before = player.inventory.micromodules.length;

    createLiveSceneController(engine).buyModule();

    expect(player.inventory.micromodules.some((m) => m.id === mm!.id)).toBe(
      true,
    );
    expect(player.inventory.micromodules.length).toBe(before + 1);
    expect(harness.errors()).toHaveLength(0);
  });

  it("takeLoan() disburses the standard loan onto the current account", () => {
    const engine = harness.engine;
    const player = engine.player!;
    expect(canTakeLoan(engine)).toBe(true);
    const creditsBefore = player.credits;

    createLiveSceneController(engine).takeLoan();

    expect(player.credits).toBe(creditsBefore + 5000);
    expect(playerLoanBalance(engine)).toBeGreaterThan(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("repayLoan() pays down the outstanding balance", () => {
    const engine = harness.engine;
    executeTakeLoan(engine);
    const owedBefore = playerLoanBalance(engine);
    const creditsBefore = engine.player!.credits;

    createLiveSceneController(engine).repayLoan();

    expect(playerLoanBalance(engine)).toBeLessThan(owedBefore);
    expect(engine.player!.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("sellCargo() sells every held unit at the landed planet's market", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    const planet = sys.planets[0];
    await harness.goTo(SceneType.PLANET, { planet });

    const good = planet.market.availableResources[0];
    expect(good).toBeTruthy();
    engine.player!.inventory.addResource(good, 10);
    const creditsBefore = engine.player!.credits;

    createLiveSceneController(engine).sellCargo();

    expect(
      engine.player!.inventory.resources.find((r) => r.type === good)?.amount ??
        0,
    ).toBe(0);
    expect(engine.player!.credits).toBeGreaterThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("sellCargo() is a safe no-op when not landed on a planet", () => {
    const engine = harness.engine;
    expect(engine.player!.landedPlanetId).toBeFalsy();
    const creditsBefore = engine.player!.credits;

    expect(() => createLiveSceneController(engine).sellCargo()).not.toThrow();

    expect(engine.player!.credits).toBe(creditsBefore);
  });

  it("repair() is a safe no-op with no player/ship (never throws)", () => {
    const bareEngine = { player: null } as unknown as GameEngine;
    expect(() => createLiveSceneController(bareEngine).repair()).not.toThrow();
  });
});

describe("live buy-accounting skew — AgentMemory recovers the real buy price (Task 6)", () => {
  it(
    "a buy detected one fold after leaving the landed planet still records the " +
      "planet's real buy price, not 0",
    async () => {
      const harness = await RealEngineHarness.boot({
        seed: "LIVE-BUY-SKEW-TEST",
      });
      await harness.newGame();
      const engine = harness.engine;
      const sys = currentSystem(engine)!;
      const planet = sys.planets[0];
      adjustPlayerCredits(
        engine.bank,
        engine.player!,
        500000,
        GL_COUNTERPARTY.REWARDS,
        "test seed",
      );

      // Fold 1: land, observe the market (mirrors AutopilotController.tickOnce
      // observing BEFORE the trade executes).
      await harness.goTo(SceneType.PLANET, { planet });
      let mem = updateMemory(createMemory(), observe(engine));

      // Pick the cheapest available good as the explicit preferred good and
      // record its price BEFORE the trade executes — sell-only null-good
      // buys nothing since the 20260703 no-speculation fix, so this test
      // drives a real buy via `executeMemoryAwareTrade` directly.
      const ts = new TradeSystem();
      let good = planet.market.availableResources[0];
      let expectedBuyPrice = ts.getBuyPrice(planet, good, engine.player!);
      for (const candidate of planet.market.availableResources) {
        const price = ts.getBuyPrice(planet, candidate, engine.player!);
        if (price > 0 && price < expectedBuyPrice) {
          expectedBuyPrice = price;
          good = candidate;
        }
      }

      // The live `openTrade` verb executes the real trade, THEN transitions
      // to SPACE_FLIGHT — mirroring `createLiveSceneController.openTrade`.
      executeMemoryAwareTrade(engine, planet, good);
      await harness.goTo(SceneType.SPACE_FLIGHT);

      // Fold 2: the next tick's observation — currentPlanet is now null, but
      // the cargo delta from the trade is visible for the first time here.
      mem = updateMemory(mem, observe(engine));

      const boughtLot = mem.inventoryLots.find((l) => l.good === good);
      expect(boughtLot).toBeDefined();
      expect(boughtLot!.buyPrice).toBe(expectedBuyPrice);
      expect(boughtLot!.buyPrice).not.toBe(0);

      harness.dispose();
    },
  );
});

describe("live openTrade() consults the known cross-planet margin (not sell-only forever)", () => {
  it("buys the memory's known-margin good when landed at that margin's own buy planet", async () => {
    // Regression: `openTrade` used to hardcode `executeTradeOnPlanet(engine,
    // planet)` — `executeMemoryAwareTrade(engine, planet, null)` — which the
    // 20260703 no-speculation fix redefined as sell-only. The live autopilot
    // could therefore never execute a `buy-low`/price-discovery buy the
    // heuristic ladder decided on, only ever sell, unlike the headless
    // PlayerAgent (which passes a real preferred good). `createLiveSceneController`
    // now takes a `getMemory` so `openTrade` can mirror PlayerAgent's lookup.
    const harness = await RealEngineHarness.boot({
      seed: "LIVE-OPEN-TRADE-MARGIN-TEST",
    });
    await harness.newGame();
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    const planet = sys.planets[0];
    adjustPlayerCredits(
      engine.bank,
      engine.player!,
      500000,
      GL_COUNTERPARTY.REWARDS,
      "test seed",
    );
    await harness.goTo(SceneType.PLANET, { planet });

    const ts = new TradeSystem();
    const good = planet.market.availableResources[0];
    const buyPrice = ts.getBuyPrice(planet, good, engine.player!);
    expect(buyPrice).toBeGreaterThan(0);

    // A known margin whose buy planet IS the one the player is standing on
    // — bestKnownMargin should pick this good, and openTrade should buy it.
    const memory = createMemory();
    memory.priceBook.set(
      planet.id,
      new Map([[good, { buy: buyPrice, sell: 1, seenAt: 0 }]]),
    );
    memory.priceBook.set(
      "fake-sell-planet",
      new Map([[good, { buy: 999999, sell: buyPrice + 500, seenAt: 0 }]]),
    );

    const creditsBefore = engine.player!.credits;
    const cargoBefore =
      engine.player!.inventory.resources.find((r) => r.type === good)?.amount ??
      0;

    await createLiveSceneController(engine, () => memory).openTrade();

    expect(
      engine.player!.inventory.resources.find((r) => r.type === good)?.amount ??
        0,
    ).toBeGreaterThan(cargoBefore);
    expect(engine.player!.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);

    harness.dispose();
  });

  it("stays sell-only (never buys) when no memory is supplied — the default", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "LIVE-OPEN-TRADE-DEFAULT-TEST",
    });
    await harness.newGame();
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    const planet = sys.planets[0];
    adjustPlayerCredits(
      engine.bank,
      engine.player!,
      500000,
      GL_COUNTERPARTY.REWARDS,
      "test seed",
    );
    await harness.goTo(SceneType.PLANET, { planet });

    const creditsBefore = engine.player!.credits;

    await createLiveSceneController(engine).openTrade();

    // No margin known (fresh memory) ⇒ no preferred good ⇒ sell-only: credits
    // never drop (no speculative buy), matching the no-speculation fix.
    expect(engine.player!.credits).toBeGreaterThanOrEqual(creditsBefore);
    expect(harness.errors()).toHaveLength(0);

    harness.dispose();
  });
});
