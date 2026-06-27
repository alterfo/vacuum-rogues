import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { ShipDeathFxRenderer } from "@/presentation/flight/shipDeathFxRenderer";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { setReducedMotion } from "@/presentation/ui/reducedMotion";

/**
 * Task 3 (quest-card-scroll + ship-death plan): a ship death now **explodes**.
 * `NpcShipManager.handleInFlightDeath` is the single in-flight death path (every
 * NPC kill — player, crossfire, the Overmind core — routes through it), so a kill
 * must seed the pure {@link ShipDeathFxRenderer} blast at the wreck. This pins the
 * wiring over the *real* engine (the renderer is built in `initialize()` and torn
 * down in `destroy()`): a kill seeds sparks, the accessibility reduced-motion flag
 * suppresses the burst entirely, scene teardown leaves the game layer clean, and
 * the whole flow logs zero errors. Only PixiJS is stubbed (same harness as
 * `combatPauseFreezesLiveFight.test.ts`).
 *
 * The harness installs a no-op 2D-canvas stub, so `softGlowTexture` resolves and
 * the renderer's pooled (stub) `ParticleContainer` is genuinely built + mounted —
 * which lets the teardown test assert the layer is removed from the game layer on
 * scene destroy. The spark count itself reads the PixiJS-free emitter, so it is
 * meaningful regardless of whether the particle layer was built.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightPrivates {
  npcManager: NpcShipManager;
}

/** A minimal hostile sprite covering only what the death path reads. */
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

/** Read the (private) ship-death FX renderer the NPC manager owns. */
function deathFxOf(npcManager: NpcShipManager): ShipDeathFxRenderer {
  return (npcManager as unknown as { deathFx: ShipDeathFxRenderer }).deathFx;
}

/** Read the renderer's (private) pooled-particle layer, if one was built. */
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
    // `killedByPlayer=false` + an rng that rolls 0 loot keeps the focus on the FX
    // (no salvage/liberation side effects, no loot sprites to mount).
    npcManager.handleInFlightDeath(enemy, () => 0, false);

    expect(deathFx.count).toBeGreaterThan(0); // sparks seeded
    expect(deathFx.isActive()).toBe(true);
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

    // The harness 2D-canvas stub lets softGlowTexture resolve, so the pooled
    // particle layer is actually built + mounted on the game layer.
    const gameLayer = harness.engine.renderer!.gameLayer;
    const fxLayer = fxLayerOf(deathFx);
    expect(fxLayer).toBeTruthy();
    expect(gameLayer.children).toContain(fxLayer);

    // Real per-frame update path ages the burst past the longest spark lifetime —
    // the pool clears to empty (no leak), and no frame logs an error.
    for (let i = 0; i < 30; i++) harness.tick(64);
    expect(deathFx.isActive()).toBe(false);
    expect(deathFx.count).toBe(0);

    // Leaving SPACE_FLIGHT tears the scene (and the FX renderer) down: its
    // particle layer is removed from the game layer (the next scene rebuilds it).
    await harness.goTo(SceneType.MAIN_MENU);
    expect(gameLayer.children).not.toContain(fxLayer);
    expect(harness.errors()).toEqual([]);
  });
});
