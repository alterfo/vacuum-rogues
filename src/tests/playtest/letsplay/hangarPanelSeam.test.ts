import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GameScene } from "@/presentation/GameScene";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType, StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem, executeRepair } from "./engineQueries";
import {
  bestAffordableGear,
  bestAffordableHull,
  cheapestMicromodule,
  executeBuyBestGear,
  executeUpgradeHull,
  executeBuyBestModule,
} from "./equipmentQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function seamScene() {
  const calls: string[] = [];
  const open = vi.fn(() => {
    calls.push("open");
  });
  const close = vi.fn(() => {
    calls.push("close");
  });
  return {
    scene: {
      e2eOpenHangar: open,
      e2eCloseHangar: close,
    } as unknown as GameScene,
    open,
    close,
    calls,
  };
}

describe("hangar-panel seam wiring (Task 5)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "HANGAR-SEAM-TEST" });
    await harness.newGame();

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

  it("executeRepair drives open/close around the real hull repair", () => {
    const engine = harness.engine;
    const player = engine.player!;
    player.ship.hullHP = Math.max(1, player.ship.maxHull - 50);
    const hullBefore = player.ship.hullHP;
    const creditsBefore = player.credits;
    const { scene, open, close, calls } = seamScene();
    engine.currentScene = scene;

    executeRepair(engine);

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["open", "close"]); // open BEFORE close
    expect(player.ship.hullHP).toBeGreaterThan(hullBefore);
    expect(player.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeBuyBestGear drives open/close around the real gear buy", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const listing = bestAffordableGear(engine)!;
    expect(listing).toBeTruthy();
    const ownedBefore = player.inventory.ownedGearIds.length;
    const { scene, open, close } = seamScene();
    engine.currentScene = scene;

    executeBuyBestGear(engine);

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(player.inventory.ownedGearIds).toContain(listing.gear.id);
    expect(player.inventory.ownedGearIds.length).toBe(ownedBefore + 1);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeUpgradeHull drives open/close around the real hull trade-in", () => {
    const engine = harness.engine;
    const loadout = engine.playerLoadout!;
    const oldHullId = loadout.hull.id;
    const listing = bestAffordableHull(engine)!;
    expect(listing).toBeTruthy();
    const { scene, open, close } = seamScene();
    engine.currentScene = scene;

    executeUpgradeHull(engine);

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(loadout.hull.id).toBe(listing.gear.id);
    expect(loadout.hull.id).not.toBe(oldHullId);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeBuyBestModule drives open/close around the real micromodule buy", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const mm = cheapestMicromodule(engine)!;
    expect(mm).toBeTruthy();
    const before = player.inventory.micromodules.length;
    const { scene, open, close } = seamScene();
    engine.currentScene = scene;

    executeBuyBestModule(engine);

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(player.inventory.micromodules.some((m) => m.id === mm.id)).toBe(
      true,
    );
    expect(player.inventory.micromodules.length).toBe(before + 1);
    expect(harness.errors()).toHaveLength(0);
  });

  it("does NOT open the hangar when the refit is a no-op (nothing affordable)", () => {
    const engine = harness.engine;
    const player = engine.player!;
    adjustPlayerCredits(
      engine.bank,
      player,
      -player.credits,
      GL_COUNTERPARTY.EQUIPMENT,
      "drain for test",
    );
    const { scene, open, close } = seamScene();
    engine.currentScene = scene;

    executeBuyBestGear(engine);
    executeUpgradeHull(engine);
    executeBuyBestModule(engine);
    executeRepair(engine); // hull already perfect on a fresh game

    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(harness.errors()).toHaveLength(0);
  });

  it("falls back to the domain mutation when the scene has no hangar seams", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const listing = bestAffordableGear(engine)!;
    const creditsBefore = player.credits;
    const ownedBefore = player.inventory.ownedGearIds.length;
    engine.currentScene = {} as unknown as GameScene;

    expect(() => executeBuyBestGear(engine)).not.toThrow();

    expect(player.inventory.ownedGearIds).toContain(listing.gear.id);
    expect(player.inventory.ownedGearIds.length).toBe(ownedBefore + 1);
    expect(player.credits).toBe(creditsBefore - listing.price);
    expect(harness.errors()).toHaveLength(0);
  });

  it("falls back to the domain mutation when currentScene is null", () => {
    const engine = harness.engine;
    const player = engine.player!;
    player.ship.hullHP = Math.max(1, player.ship.maxHull - 40);
    const hullBefore = player.ship.hullHP;
    engine.currentScene = null;

    expect(() => executeRepair(engine)).not.toThrow();

    expect(player.ship.hullHP).toBeGreaterThan(hullBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("routes a real repair through a docked StationScene's hangar view", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    const station = sys.stations[0];
    await harness.goTo(SceneType.STATION, { station });

    const player = engine.player!;
    player.ship.hullHP = Math.max(1, player.ship.maxHull - 50);
    const hullBefore = player.ship.hullHP;

    executeRepair(engine);

    const view = (engine.currentScene as unknown as { view: string }).view;
    expect(view).toBe("main");
    expect(player.ship.hullHP).toBeGreaterThan(hullBefore);
    expect(harness.errors()).toHaveLength(0);
  });
});
