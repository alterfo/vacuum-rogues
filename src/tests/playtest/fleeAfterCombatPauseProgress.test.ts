import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { createLiveSceneController } from "./letsplay/installAutopilotHook";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPauseController } from "@/presentation/flight/combatPause";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";

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

    physics.teleport(
      scene.starRenderer.centerX + 800,
      scene.starRenderer.centerY,
    );

    const enemy = makeHostile("flee-foe", physics.shipX + 100, physics.shipY);
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    combatModule.addCombatant(enemy);
    expect(combatModule.isActive).toBe(true);
    scene.isTurnRunning = true;

    expect(combatPause.requestPause("incoming-attack")).toBe(true);
    expect(combatPause.paused).toBe(true);

    const controller = createLiveSceneController(harness.engine);
    void controller.flee();
    expect(combatPause.paused).toBe(false);

    const samples: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 20; i++) {
      controller.tick();
      for (let f = 0; f < 10; f++) harness.tick(100); // 1s of real frames
      samples.push({ x: physics.shipX, y: physics.shipY });
    }

    let anyProgress = false;
    for (let i = 1; i < samples.length; i++) {
      const d = Math.hypot(
        samples[i].x - samples[i - 1].x,
        samples[i].y - samples[i - 1].y,
      );
      if (d > 1) anyProgress = true;
    }
    expect(anyProgress).toBe(true);

    const tail = samples.slice(-5);
    const tailStalled = tail.every(
      (s, i) =>
        i === 0 || Math.hypot(s.x - tail[i - 1].x, s.y - tail[i - 1].y) < 0.5,
    );
    expect(tailStalled && scene.isTurnRunning && !physics.isMoving).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
