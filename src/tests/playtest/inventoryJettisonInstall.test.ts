import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, ResourceType } from "@/types";
import type { InventoryScene } from "@/presentation/InventoryScene";

/**
 * Real-engine playtest (Bug 2): jettisoning owned gear/cargo from the
 * inventory scene reduces the domain state and grants nothing — a credit
 * grant here would mean jettison silently doubled as an unpaid sale. Also
 * covers install-from-warehouse wiring into the real `ShipLoadout`.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("InventoryScene — jettison/install wiring (Bug 2)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("jettisoning owned gear removes it from the store and grants no credits", async () => {
    const player = harness.player();
    expect(player).not.toBeNull();
    player!.inventory.addOwnedGear("eq_radar");
    const creditsBefore = player!.credits;

    await harness.goTo(SceneType.INVENTORY);
    const scene = harness.currentScene() as unknown as InventoryScene;

    scene.requestJettisonConfirm("gear", "eq_radar");
    scene.confirmJettison();

    expect(player!.inventory.ownedGearIds).not.toContain("eq_radar");
    expect(player!.credits).toBe(creditsBefore);
    expect(harness.errors()).toEqual([]);
  });

  it("jettisoning a cargo stack removes it and grants no credits", async () => {
    const player = harness.player();
    expect(player).not.toBeNull();
    player!.inventory.addResource(ResourceType.METALS, 5);
    const creditsBefore = player!.credits;

    await harness.goTo(SceneType.INVENTORY);
    const scene = harness.currentScene() as unknown as InventoryScene;

    scene.requestJettisonConfirm("resource", ResourceType.METALS);
    scene.confirmJettison();

    expect(
      player!.inventory.resources.find((r) => r.type === ResourceType.METALS)
        ?.amount ?? 0,
    ).toBe(0);
    expect(player!.credits).toBe(creditsBefore);
    expect(harness.errors()).toEqual([]);
  });

  it("installing from the warehouse fits the gear into the real loadout", async () => {
    const player = harness.player();
    expect(player).not.toBeNull();
    player!.inventory.addOwnedGear("eq_radar");

    await harness.goTo(SceneType.INVENTORY);
    const scene = harness.currentScene() as unknown as InventoryScene;

    scene.installFromWarehouse("eq_radar");

    expect(player!.inventory.ownedGearIds).not.toContain("eq_radar");
    expect(harness.engine.playerLoadout?.installedGearIds()).toContain(
      "eq_radar",
    );
    expect(harness.errors()).toEqual([]);
  });

  it("a blocked install (hull id, never fits a slot) leaves the warehouse item untouched and shows feedback", async () => {
    // Mirrors HangarPanel.installFromWarehouse's explainInstallBlock guard —
    // InventoryScene must not silently no-op the [Установить] button.
    const player = harness.player();
    expect(player).not.toBeNull();
    player!.inventory.addOwnedGear("hull_corvette");

    await harness.goTo(SceneType.INVENTORY);
    const scene = harness.currentScene() as unknown as InventoryScene;

    scene.installFromWarehouse("hull_corvette");

    expect(player!.inventory.ownedGearIds).toContain("hull_corvette");
    expect(harness.engine.playerLoadout?.installedGearIds()).not.toContain(
      "hull_corvette",
    );
    const toastTexts = (
      harness.engine.renderer!.stage.children as Array<{ text?: string }>
    )
      .map((c) => c.text)
      .filter((text): text is string => !!text);
    expect(toastTexts.length).toBeGreaterThan(0);
    expect(harness.errors()).toEqual([]);
  });
});
