import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { EquipmentHit } from "@/systems/info/GalacticRegistry";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("Task 12: infocenter route-to-shop + purchase quest", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("same-system hit: adds a purchase quest and plots an in-system route", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const currentSystemId = harness.player()!.currentSystemId;
    const registry = harness.engine.getInfoRegistry()!;
    const hits = registry.findEquipment({ originSystemId: currentSystemId });
    const hit = hits.find(
      (h) => h.jumps === 0 && h.systemId === currentSystemId,
    );
    expect(hit).toBeDefined();

    await harness.goTo(SceneType.INFO_CENTER, {});
    const infoScene = harness.currentScene() as unknown as {
      routeToShop(hit: EquipmentHit): Promise<void>;
    };
    await infoScene.routeToShop(hit!);

    const quest = [
      ...harness.quests().getActiveQuests(),
      ...harness.quests().getPendingReturnQuests(),
    ].find((q) => q.targetPlanetId === hit!.planetId);
    expect(quest).toBeDefined();
    expect(quest!.targetSystemId).toBe(hit!.systemId);

    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const flightScene = harness.currentScene() as unknown as {
      plannedRoute: { x: number; y: number } | null;
    };
    expect(flightScene.plannedRoute).not.toBeNull();

    expect(harness.errors()).toEqual([]);
  });

  it("cross-system hit: adds a purchase quest and warps toward the target system", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const currentSystemId = harness.player()!.currentSystemId;
    const registry = harness.engine.getInfoRegistry()!;
    const hits = registry.findEquipment({ originSystemId: currentSystemId });
    const hit = hits.find((h) => h.jumps > 0);
    expect(hit).toBeDefined();

    await harness.goTo(SceneType.INFO_CENTER, {});
    const infoScene = harness.currentScene() as unknown as {
      routeToShop(hit: EquipmentHit): Promise<void>;
    };
    await infoScene.routeToShop(hit!);

    const quest = harness
      .quests()
      .getActiveQuests()
      .find((q) => q.targetPlanetId === hit!.planetId);
    expect(quest).toBeDefined();
    expect(quest!.targetSystemId).toBe(hit!.systemId);

    expect(harness.currentSceneType()).toBe(SceneType.STAR_MAP);

    expect(harness.errors()).toEqual([]);
  });
});
