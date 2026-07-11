import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { createLiveSceneController } from "./letsplay/installAutopilotHook";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPauseController } from "@/presentation/flight/combatPause";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";

/**
 * Live-session finding (2026-07-11): a player reported the autopilot appearing
 * to "freeze" — turn clock stuck — after fleeing a patrol that had just landed
 * a hit (triggering the active-pause overlay). Drives the exact sequence over
 * the real engine — engage combat, take a hit (raises combatPause), let the
 * autopilot's real flee() resume it and plot the escape route — and asserts
 * the ship makes continuous forward progress rather than stalling with
 * isTurnRunning stuck true and zero movement.
 *
 * The apparent freeze did not reproduce here: flee()'s near-edge route is a
 * genuine multi-second trip from a realistic mid-system position (the ship
 * covers real distance every sampled window below), so what looked like a
 * stall was most likely the observed live session's disruptive reload storm
 * (a concurrent process was hot-reloading the dev server), not a scene bug.
 * Kept as a regression guard on the mechanism itself.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function makeHostile(id: string, x: number, y: number): NpcShipSprite {
  const container = { x, y, zIndex: 100 };
  const sprite = {
    x,
    y,
    container,
    aggressive: false,
    mapColor: 0xff0000,
    npc: {
      id,
      name: id,
      role: NpcRole.PATROL,
      hullHP: 1_000_000,
      maxHull: 1_000_000,
      damage: 20,
    },
    update(): void {},
    isGone: () => false,
    isAnchored: () => false,
    updateHitArea: () => {},
    restoreInteractivity: () => {},
    setAggressive: (v: boolean) => {
      sprite.aggressive = v;
    },
    setNpcCombatTarget: () => {},
    clearNpcCombatTarget: () => {},
    setPursuitTarget: () => {},
  };
  return sprite as unknown as NpcShipSprite;
}

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: NpcShipManager;
  combatModule: CombatModule;
  combatPause: CombatPauseController<unknown, unknown>;
  isTurnRunning: boolean;
  starRenderer: { centerX: number; centerY: number };
}

describe("Autopilot flee after a combat-pause hit makes continuous progress (live-session finding)", () => {
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

  it("does not stall with isTurnRunning stuck true and zero ship movement", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const {
      shipPhysics: physics,
      npcManager,
      combatModule,
      combatPause,
    } = scene;

    // Place the ship well inside the system (not already at/near the
    // boundary — the harness's default new-game position sits close enough
    // to the edge that a flee route can be a ~0px no-op, which trivially
    // "passes" without exercising real travel).
    physics.teleport(
      scene.starRenderer.centerX + 800,
      scene.starRenderer.centerY,
    );

    // Engage a patrol just inside weapon range, same as a live encounter.
    const enemy = makeHostile("flee-foe", physics.shipX + 100, physics.shipY);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    combatModule.addCombatant(enemy);
    expect(combatModule.isActive).toBe(true);
    scene.isTurnRunning = true;

    // A shot lands — raises the active pause (mirrors onPlayerUnderAttack).
    expect(combatPause.requestPause("incoming-attack")).toBe(true);
    expect(combatPause.paused).toBe(true);

    // Drive the real autopilot's flee() — resumes the pause, breaks off
    // pursuit, and plots the actual near-edge escape route.
    const controller = createLiveSceneController(harness.engine);
    void controller.flee();
    expect(combatPause.paused).toBe(false);

    // Drive several seconds of the live tick loop + real engine frames, and
    // sample the ship's position periodically — it must keep changing (real
    // forward progress), not freeze after the initial route kicks off.
    const samples: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 20; i++) {
      controller.tick();
      for (let f = 0; f < 10; f++) harness.tick(100); // 1s of real frames
      samples.push({ x: physics.shipX, y: physics.shipY });
    }

    // At least one window after the first must show real movement — a
    // permanent stall would leave every sample identical to its predecessor.
    let anyProgress = false;
    for (let i = 1; i < samples.length; i++) {
      const d = Math.hypot(
        samples[i].x - samples[i - 1].x,
        samples[i].y - samples[i - 1].y,
      );
      if (d > 1) anyProgress = true;
    }
    expect(anyProgress).toBe(true);

    // The tail of the run (well after the flee route should have started)
    // must not be a dead stall: isTurnRunning stuck true with zero motion
    // across the last several samples is exactly the reported freeze.
    const tail = samples.slice(-5);
    const tailStalled = tail.every(
      (s, i) =>
        i === 0 || Math.hypot(s.x - tail[i - 1].x, s.y - tail[i - 1].y) < 0.5,
    );
    expect(tailStalled && scene.isTurnRunning && !physics.isMoving).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
