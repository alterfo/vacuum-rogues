import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShip } from "@/domain/NpcShip";

/**
 * Playtest bug: a raw Cmd+R reload during a fight makes the nearby attackers
 * "disappear" — two compounding gaps, both real (not by-design):
 * 1. Live NPC sprite positions were only written back to their domain ships on
 *    a clean scene `destroy()`; a page-hide reload never runs that, so the NPC
 *    respawns at its stale seed position, not where the fight actually was.
 * 2. `checkGarrisonAggro`'s `engaged` check reads the live (and, on a fresh
 *    scene, always-empty) `CombatModule.combatants` set — a persisted
 *    `npc.hostile===true` NPC has no other path back into `aggressive`, so it
 *    sits passively even though it's still marked hostile.
 */
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

    // The player attacked this NPC (real hostility-propagation path) and it's
    // now an active aggressor sitting right next to the player — a fight in
    // progress at the moment of reload.
    scene.npcManager.escalateHostility(sprite.npc);
    sprite.setAggressive(true);
    sprite.x = scene.shipPhysics.shipX + 50;
    sprite.y = scene.shipPhysics.shipY;
    const npcId = sprite.npc.id;
    const liveX = sprite.x;
    const liveY = sprite.y;

    // The page-hide flush path (Fix A): record the live ship position (so the
    // reload resumes the SAME live flight, not an edge-spawn — the signal
    // Fix B's reengageNearbyHostiles gates on), mirror NPC positions, then save.
    harness.engine.recordLiveFlightPos(
      scene.shipPhysics.shipX,
      scene.shipPhysics.shipY,
    );
    scene.persistLiveState?.();
    await harness.engine.saveGame("auto");

    // Simulate the reload: rebuild the engine's scene state from the save.
    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const resumedScene = harness.currentScene() as unknown as FlightPrivates;
    const resumed = resumedScene.npcManager.npcSprites.find(
      (s) => s.npc.id === npcId,
    );
    expect(resumed).toBeDefined();

    // Position preserved — not reset to the deterministic spawn position.
    expect(Math.hypot(resumed!.x - liveX, resumed!.y - liveY)).toBeLessThan(5);

    // Pursuit resumed: a hostile NPC close to the player is aggressive again.
    expect(resumed!.aggressive).toBe(true);

    expect(harness.errors()).toEqual([]);
  });

  it("does NOT resurrect a hostile NPC that is far from the player at load (an old, escaped grudge stays passive)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.npcManager.npcSprites[0];
    expect(sprite).toBeDefined();

    // Hostile from a past encounter, but far away and no longer pursuing —
    // exactly the "successfully escaped" state the fix must leave alone.
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
    // The NPC may or may not still be present in this system depending on
    // simulation rules, but if it is, it must stay passive.
    if (resumed) expect(resumed.aggressive).toBe(false);

    expect(harness.errors()).toEqual([]);
  });

  it("a normal (non-reload) scene entry does NOT reengage a nearby hostile — only a genuine resume does", async () => {
    // Regression guard: reengageNearbyHostiles() must be gated on a genuine
    // flight resume (isResumedFlight), never fire on every ordinary
    // initialize() (dock/undock/hyperjump) — an earlier version of this fix
    // fired unconditionally and made routine system entry near an old
    // hostile more dangerous than intended (dropped the letsplay CI
    // survival-rate gate below its threshold).
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.npcManager.npcSprites[0];
    expect(sprite).toBeDefined();

    scene.npcManager.escalateHostility(sprite.npc);
    sprite.setAggressive(false);
    sprite.x = scene.shipPhysics.shipX + 50; // right next to the player
    sprite.y = scene.shipPhysics.shipY;

    // A plain re-initialize (no resume signal) — e.g. what a normal
    // undock/hyperjump/system-entry drives.
    scene.npcManager.initialize();

    expect(sprite.aggressive).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
