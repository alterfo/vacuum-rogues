/**
 * Task 3 regression: real-engine executors for the 6 new letsplay actions
 * (buy-gear, upgrade-hull, buy-module, take-loan, repay-loan, sell-cargo).
 *
 * Mirrors `trade.test.ts`'s approach: call each `equipmentQueries`/`bankingQueries`/
 * `engineQueries` executor directly against a real `GameEngine`, asserting the
 * genuine domain effect (credits/gear/loan state change) with zero harness
 * errors — no mocked seam. `PlayerAgent.apply`'s new switch cases are thin
 * wrappers over these same executors (see `PlayerAgent.ts`), so exercising the
 * executors directly covers the behaviour the applier drives.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem, executeSellAll } from "./engineQueries";
import {
  bestAffordableGear,
  bestAffordableHull,
  cheapestMicromodule,
  executeBuyBestGear,
  executeUpgradeHull,
  executeBuyBestModule,
} from "./equipmentQueries";
import {
  playerLoanBalance,
  canTakeLoan,
  executeTakeLoan,
  executeRepayLoan,
} from "./bankingQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("letsplay new-action executors (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "NEWACTIONS-TEST" });
    await harness.newGame();

    // Guarantee a shoppable system: a CRAFT_CENTER station, plus a tech level
    // high enough to unlock hull listings (the cheapest hull is techLevel 2;
    // a fresh system defaults to techLevel 1, which `generateShop` would filter
    // out entirely).
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
    // Deep pockets so affordability never gates the assertions below.
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

  it("executeBuyBestGear acquires owned gear and spends the listing price", () => {
    const listing = bestAffordableGear(harness.engine);
    expect(listing).toBeTruthy();
    const player = harness.engine.player!;
    const creditsBefore = player.credits;
    const ownedBefore = player.inventory.ownedGearIds.length;

    executeBuyBestGear(harness.engine);

    expect(player.inventory.ownedGearIds).toContain(listing!.gear.id);
    expect(player.inventory.ownedGearIds.length).toBe(ownedBefore + 1);
    expect(player.credits).toBe(creditsBefore - listing!.price);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeBuyBestGear is a safe no-op when nothing in-system is affordable", () => {
    const player = harness.engine.player!;
    adjustPlayerCredits(
      harness.engine.bank,
      player,
      -player.credits,
      GL_COUNTERPARTY.EQUIPMENT,
      "drain for test",
    );
    expect(bestAffordableGear(harness.engine)).toBeNull();
    const ownedBefore = player.inventory.ownedGearIds.length;

    executeBuyBestGear(harness.engine);

    expect(player.inventory.ownedGearIds.length).toBe(ownedBefore);
    expect(player.credits).toBe(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeUpgradeHull trades in the fitted hull for the priciest affordable one", () => {
    const loadout = harness.engine.playerLoadout!;
    const oldHullId = loadout.hull.id;
    const listing = bestAffordableHull(harness.engine);
    expect(listing).toBeTruthy();

    executeUpgradeHull(harness.engine);

    expect(loadout.hull.id).toBe(listing!.gear.id);
    expect(loadout.hull.id).not.toBe(oldHullId);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeUpgradeHull is a safe no-op when nothing in-system is affordable", () => {
    const player = harness.engine.player!;
    const loadout = harness.engine.playerLoadout!;
    const oldHullId = loadout.hull.id;
    adjustPlayerCredits(
      harness.engine.bank,
      player,
      -player.credits,
      GL_COUNTERPARTY.EQUIPMENT,
      "drain for test",
    );
    expect(bestAffordableHull(harness.engine)).toBeNull();

    executeUpgradeHull(harness.engine);

    expect(loadout.hull.id).toBe(oldHullId);
    expect(player.credits).toBe(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeBuyBestModule buys an unowned micromodule", () => {
    const player = harness.engine.player!;
    const mm = cheapestMicromodule(harness.engine);
    expect(mm).toBeTruthy();
    const before = player.inventory.micromodules.length;

    executeBuyBestModule(harness.engine);

    expect(player.inventory.micromodules.some((m) => m.id === mm!.id)).toBe(
      true,
    );
    expect(player.inventory.micromodules.length).toBe(before + 1);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeBuyBestModule is a safe no-op when no module is affordable", () => {
    const player = harness.engine.player!;
    adjustPlayerCredits(
      harness.engine.bank,
      player,
      -player.credits,
      GL_COUNTERPARTY.EQUIPMENT,
      "drain for test",
    );
    expect(cheapestMicromodule(harness.engine)).toBeNull();
    const before = player.inventory.micromodules.length;

    executeBuyBestModule(harness.engine);

    expect(player.inventory.micromodules.length).toBe(before);
    expect(player.credits).toBe(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTakeLoan disburses the standard loan onto the current account", () => {
    const player = harness.engine.player!;
    expect(canTakeLoan(harness.engine)).toBe(true);
    const creditsBefore = player.credits;

    executeTakeLoan(harness.engine);

    expect(player.credits).toBe(creditsBefore + 5000);
    expect(playerLoanBalance(harness.engine)).toBeGreaterThan(0);
    expect(canTakeLoan(harness.engine)).toBe(false);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTakeLoan is a no-op while a loan is already outstanding", () => {
    executeTakeLoan(harness.engine);
    const balanceAfterFirst = playerLoanBalance(harness.engine);
    const creditsAfterFirst = harness.engine.player!.credits;

    executeTakeLoan(harness.engine); // second call must not stack a loan

    expect(playerLoanBalance(harness.engine)).toBe(balanceAfterFirst);
    expect(harness.engine.player!.credits).toBe(creditsAfterFirst);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeRepayLoan pays down the outstanding balance", () => {
    executeTakeLoan(harness.engine);
    const owedBefore = playerLoanBalance(harness.engine);
    const creditsBefore = harness.engine.player!.credits;

    executeRepayLoan(harness.engine);

    expect(playerLoanBalance(harness.engine)).toBeLessThan(owedBefore);
    expect(harness.engine.player!.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeRepayLoan is a safe no-op with no outstanding loan", () => {
    expect(playerLoanBalance(harness.engine)).toBe(0);
    const creditsBefore = harness.engine.player!.credits;

    executeRepayLoan(harness.engine);

    expect(harness.engine.player!.credits).toBe(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeSellAll sells every held unit at the landed planet's market", () => {
    const sys = currentSystem(harness.engine)!;
    const planet = sys.planets[0];
    expect(planet).toBeTruthy();
    const good = planet.market.availableResources[0];
    expect(good).toBeTruthy();
    harness.engine.player!.inventory.addResource(good, 10);
    const creditsBefore = harness.engine.player!.credits;

    executeSellAll(harness.engine, planet);

    expect(
      harness.engine.player!.inventory.resources.find((r) => r.type === good)
        ?.amount ?? 0,
    ).toBe(0);
    expect(harness.engine.player!.credits).toBeGreaterThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });
});
