import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { ShipDeathFxRenderer } from "@/presentation/flight/shipDeathFxRenderer";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { setReducedMotion } from "@/presentation/ui/reducedMotion";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightPrivates {
  npcManager: NpcShipManager;
}

function makeHostile(id: string, x: number, y: number): NpcShipSprite {
  const container = { parent: null, zIndex: 100 };
  return {
    x,
    y,
    container,
    npc: {
      id,
      name: id,
      role: NpcRole.PATROL,
      hullHP: 100,
      maxHull: 100,
      damage: 10,
      loadoutSummary: [] as string[],
    },
    destroy: () => {},
  } as unknown as NpcShipSprite;
}

function deathFxOf(npcManager: NpcShipManager): ShipDeathFxRenderer {
  return (npcManager as unknown as { deathFx: ShipDeathFxRenderer }).deathFx;
}

function fxLayerOf(
  deathFx: ShipDeathFxRenderer,
): { children: unknown[] } | null {
  return (deathFx as unknown as { layer: { children: unknown[] } | null })
    .layer;
}

describe("Ship-death explosion wiring over the real engine (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a killed NPC seeds an explosion burst at the wreck", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { npcManager } = scene;
    const deathFx = deathFxOf(npcManager);
    expect(deathFx).toBeTruthy();
    expect(deathFx.isActive()).toBe(false); // nothing burning yet

    const enemy = makeHostile("blast-foe", 400, 250);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    npcManager.handleInFlightDeath(enemy, () => 0, false);

    expect(deathFx.count).toBeGreaterThan(0); // sparks seeded
    expect(deathFx.isActive()).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("a kill fires the one-shot explosion SFX", () => {
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { npcManager } = scene;
    const sfx = vi
      .spyOn(harness.engine.audio, "playSfx")
      .mockResolvedValue(undefined);

    const enemy = makeHostile("boom-foe", 350, 280);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    npcManager.handleInFlightDeath(enemy, () => 0, false);

    expect(sfx).toHaveBeenCalledWith("explosion");
    expect(harness.errors()).toEqual([]);
  });

  it("seeds NO burst when reduced motion is enabled", () => {
    setReducedMotion(true);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { npcManager } = scene;
    const deathFx = deathFxOf(npcManager);

    const enemy = makeHostile("quiet-foe", 300, 300);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    npcManager.handleInFlightDeath(enemy, () => 0, false);

    expect(deathFx.count).toBe(0); // reduced motion → no explosion at all
    expect(deathFx.isActive()).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("the burst ages each frame and scene teardown removes its layer", async () => {
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { npcManager } = scene;
    const deathFx = deathFxOf(npcManager);

    const enemy = makeHostile("fade-foe", 500, 200);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    npcManager.handleInFlightDeath(enemy, () => 0, false);
    expect(deathFx.count).toBeGreaterThan(0);

    const gameLayer = harness.engine.renderer!.gameLayer;
    const fxLayer = fxLayerOf(deathFx);
    expect(fxLayer).toBeTruthy();
    expect(gameLayer.children).toContain(fxLayer);

    for (let i = 0; i < 30; i++) harness.tick(64);
    expect(deathFx.isActive()).toBe(false);
    expect(deathFx.count).toBe(0);

    await harness.goTo(SceneType.MAIN_MENU);
    expect(gameLayer.children).not.toContain(fxLayer);
    expect(harness.errors()).toEqual([]);
  });
});
