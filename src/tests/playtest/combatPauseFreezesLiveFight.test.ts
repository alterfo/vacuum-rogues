import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPauseController } from "@/presentation/flight/combatPause";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms — one fire cadence

function makeDriftingHostile(id: string, x: number, y: number): NpcShipSprite {
  const container = { x, y, zIndex: 100 };
  const sprite = {
    x,
    y,
    container,
    aggressive: false, // we engage it manually via addCombatant — no AI side effects
    mapColor: 0xff0000,
    npc: {
      id,
      name: id,
      role: NpcRole.PATROL, // non-pirate → no shakedown / good-rep break-off paths
      hullHP: 1_000_000,
      maxHull: 1_000_000,
      damage: 20,
    },
    update(dt: number): void {
      this.x += 0.05 * dt;
      container.x = this.x;
      container.y = this.y;
    },
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
    setGrappled: () => {},
  };
  return sprite as unknown as NpcShipSprite;
}

function makeStaticHostile(id: string, x: number, y: number): NpcShipSprite {
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
    setGrappled: () => {},
  };
  return sprite as unknown as NpcShipSprite;
}

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: NpcShipManager;
  combatModule: CombatModule;
  combatPause: CombatPauseController<unknown, unknown>;
  combatPlanning: {
    isPlanning: boolean;
    isExecuting: boolean;
    confirm(): boolean;
  };
  isTurnRunning: boolean;
  pauseAtDayBoundary: boolean;
  plannedRoute: { x: number; y: number } | null;
  hud: { onPlayPause: (() => void) | null };
}

describe("Active pause freezes the live fight over the real engine (Task 1)", () => {
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

  it("freezes ship movement, NPC movement, and all fire while combat is paused", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatModule } = scene;
    const combatPause = scene.combatPause;
    expect(physics).toBeTruthy();

    const enemy = makeDriftingHostile(
      "freeze-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    combatModule.addCombatant(enemy); // auto-selects `enemy` as the combat target
    expect(combatModule.isActive).toBe(true);
    scene.isTurnRunning = true; // a fight holds the turn open
    physics.setTarget(physics.shipX + 5000, physics.shipY); // give the ship a heading

    const ship0 = { x: physics.shipX, y: physics.shipY };
    const enemy0 = { x: enemy.x, y: enemy.y };
    for (let i = 0; i < 8; i++) harness.tick(60); // 480 ms total < 2500 ms
    expect(combatPause.paused).toBe(false); // no hit yet → still real-time
    expect(
      Math.hypot(physics.shipX - ship0.x, physics.shipY - ship0.y),
    ).toBeGreaterThan(0); // ship maneuvers in real-time combat
    expect(Math.hypot(enemy.x - enemy0.x, enemy.y - enemy0.y)).toBeGreaterThan(
      0,
    ); // NPC sim advances in real-time combat

    expect(combatPause.requestPause("incoming-attack")).toBe(true);
    expect(combatPause.paused).toBe(true);

    const shipFrozen = {
      x: physics.shipX,
      y: physics.shipY,
      angle: physics.shipAngle,
    };
    const enemyFrozen = { x: enemy.x, y: enemy.y };
    const playerHull0 = harness.player()!.ship.hullHP;
    const enemyHull0 = enemy.npc.hullHP;

    for (let i = 0; i < 5; i++) harness.tick(FIRE);

    expect(physics.shipX).toBe(shipFrozen.x); // ship movement frozen
    expect(physics.shipY).toBe(shipFrozen.y);
    expect(physics.shipAngle).toBe(shipFrozen.angle); // ship rotation frozen (no steering)
    expect(enemy.x).toBe(enemyFrozen.x); // NPC movement frozen
    expect(enemy.y).toBe(enemyFrozen.y);
    expect(harness.player()!.ship.hullHP).toBe(playerHull0); // no NPC shot landed
    expect(enemy.npc.hullHP).toBe(enemyHull0); // no player shot landed
    expect(combatPause.paused).toBe(true); // still paused through the window
    expect(harness.errors()).toEqual([]);
  });

  it("opens tactical planning immediately when the player initiates attack, even while flying (Task 14.5a — no more deferred pause)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPlanning } = scene;
    expect(physics).toBeTruthy();

    const enemy = makeDriftingHostile(
      "instant-pause-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    scene.isTurnRunning = true; // covers the "turn was running" case
    physics.setTarget(physics.shipX + 5000, physics.shipY); // ship was moving

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(combatPlanning.isPlanning).toBe(true); // frozen immediately, ship or not
    expect(scene.pauseAtDayBoundary).toBe(false); // deferral concept is gone
    expect(harness.errors()).toEqual([]);
  });

  it("starts the turn when the player initiates attack with no running turn (кружение не в момент хода)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPlanning } = scene;

    const enemy = makeDriftingHostile(
      "no-turn-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );

    scene.isTurnRunning = false;

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(combatPlanning.isPlanning).toBe(true);
    expect(scene.isTurnRunning).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("clears a pre-existing planned route when the player engages combat (no stale route)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager } = scene;

    const enemy = makeDriftingHostile(
      "route-clear-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );

    scene.plannedRoute = { x: 9999, y: 8888 };

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(scene.plannedRoute).toEqual({ x: 9999, y: 8888 });
    expect(harness.errors()).toEqual([]);
  });

  it("cycles EXECUTING back to PLANNING on its own once the round timer elapses (Task 14.5a)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPlanning } = scene;

    const enemy = makeDriftingHostile(
      "orbit-pause-foe",
      physics.shipX + 240,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    scene.isTurnRunning = true;

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(combatPlanning.isPlanning).toBe(true);

    combatPlanning.confirm();
    expect(combatPlanning.isExecuting).toBe(true);

    for (let i = 0; i < 29; i++) harness.tick(100); // 2900ms < COMBAT_ROUND_MS(3000)
    expect(combatPlanning.isExecuting).toBe(true);

    harness.tick(200); // cumulative 3100ms > 3000
    expect(combatPlanning.isPlanning).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("only lets fire land during EXECUTING, never during PLANNING (Task 14.5a)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const {
      shipPhysics: physics,
      npcManager,
      combatModule,
      combatPlanning,
    } = scene;

    const enemy = makeStaticHostile(
      "fire-pause-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );
    scene.isTurnRunning = true;

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(combatPlanning.isPlanning).toBe(true);
    const enemyHull0 = enemy.npc.hullHP;
    const playerHull0 = harness.player()!.ship.hullHP;

    for (let i = 0; i < 5; i++) harness.tick(FIRE);
    expect(enemy.npc.hullHP).toBe(enemyHull0);
    expect(harness.player()!.ship.hullHP).toBe(playerHull0);
    expect(combatModule.isActive).toBe(true);

    combatPlanning.confirm();
    for (let i = 0; i < 27; i++) harness.tick(100); // 2700ms: > FIRE, < ROUND_MS
    expect(
      enemy.npc.hullHP < enemyHull0 ||
        harness.player()!.ship.hullHP < playerHull0,
    ).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("the HUD «Ход»/«Пауза» button confirms the plan during PLANNING instead of aborting the turn (Task 14.5a)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const {
      shipPhysics: physics,
      npcManager,
      combatModule,
      combatPlanning,
    } = scene;

    const enemy = makeDriftingHostile(
      "hud-click-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    expect(combatPlanning.isPlanning).toBe(true); // planning opens immediately
    expect(scene.isTurnRunning).toBe(true); // engagement forces the turn open

    scene.hud.onPlayPause?.();

    expect(combatPlanning.isExecuting).toBe(true);
    expect(scene.isTurnRunning).toBe(true); // never desynced to false

    const enemyHull0 = enemy.npc.hullHP;
    const playerHull0 = harness.player()!.ship.hullHP;
    for (let i = 0; i < 3; i++) harness.tick(FIRE);

    expect(
      enemy.npc.hullHP < enemyHull0 ||
        harness.player()!.ship.hullHP < playerHull0,
    ).toBe(true); // a shot landed within the very first executing window
    expect(combatModule.isActive).toBe(true);
    expect(harness.errors()).toEqual([]);
  });
});
