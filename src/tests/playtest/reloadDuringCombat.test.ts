import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShip } from "@/domain/NpcShip";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: {
    npcSprites: NpcShipSprite[];
    escalateHostility(target: NpcShip): void;
    initialize(isResumedFlight?: boolean): void;
  };
  persistLiveState?(): void;
}

describe("Reload during combat preserves nearby hostile NPCs", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("keeps a nearby hostile NPC's live position and resumes its pursuit after a reload", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.npcManager.npcSprites[0];
    expect(sprite).toBeDefined();

    scene.npcManager.escalateHostility(sprite.npc);
    sprite.setAggressive(true);
    sprite.x = scene.shipPhysics.shipX + 50;
    sprite.y = scene.shipPhysics.shipY;
    const npcId = sprite.npc.id;
    const liveX = sprite.x;
    const liveY = sprite.y;

    harness.engine.recordLiveFlightPos(
      scene.shipPhysics.shipX,
      scene.shipPhysics.shipY,
    );
    scene.persistLiveState?.();
    await harness.engine.saveGame("auto");

    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const resumedScene = harness.currentScene() as unknown as FlightPrivates;
    const resumed = resumedScene.npcManager.npcSprites.find(
      (s) => s.npc.id === npcId,
    );
    expect(resumed).toBeDefined();

    expect(Math.hypot(resumed!.x - liveX, resumed!.y - liveY)).toBeLessThan(5);

    expect(resumed!.aggressive).toBe(true);

    expect(harness.errors()).toEqual([]);
  });

  it("does NOT resurrect a hostile NPC that is far from the player at load (an old, escaped grudge stays passive)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.npcManager.npcSprites[0];
    expect(sprite).toBeDefined();

    scene.npcManager.escalateHostility(sprite.npc);
    sprite.setAggressive(false);
    sprite.x = scene.shipPhysics.shipX + 50_000;
    sprite.y = scene.shipPhysics.shipY + 50_000;
    const npcId = sprite.npc.id;

    harness.engine.recordLiveFlightPos(
      scene.shipPhysics.shipX,
      scene.shipPhysics.shipY,
    );
    scene.persistLiveState?.();
    await harness.engine.saveGame("auto");
    await harness.engine.loadGame("auto");

    const resumedScene = harness.currentScene() as unknown as FlightPrivates;
    const resumed = resumedScene.npcManager.npcSprites.find(
      (s) => s.npc.id === npcId,
    );
    if (resumed) expect(resumed.aggressive).toBe(false);

    expect(harness.errors()).toEqual([]);
  });

  it("a normal (non-reload) scene entry does NOT reengage a nearby hostile — only a genuine resume does", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.npcManager.npcSprites[0];
    expect(sprite).toBeDefined();

    scene.npcManager.escalateHostility(sprite.npc);
    sprite.setAggressive(false);
    sprite.x = scene.shipPhysics.shipX + 50; // right next to the player
    sprite.y = scene.shipPhysics.shipY;

    scene.npcManager.initialize();

    expect(sprite.aggressive).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
