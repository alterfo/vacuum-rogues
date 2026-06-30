import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPauseController } from "@/presentation/flight/combatPause";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 1 (playtest bug pass): the FTL-style **active pause must freeze the whole
 * live fight** in the *wired* flight scene — not just in the {@link CombatModule}
 * unit (that is covered by `combatPauseFreeze.test.ts`). A playtester reported the
 * player ship kept maneuvering and enemies kept firing while the pause overlay was
 * up. On paper every path is gated on the single `combatPause.paused` signal
 * (`SpaceFlightScene.updateShip` early-returns; `NpcShipManager.update` returns on
 * `!isTurnRunning()` which folds in the pause; `updateCombatPursuit` returns on
 * `isPaused`; `CombatModule.isFrozen` = `isPaused`), so this regression pins the
 * **observable** state over the real engine: with combat engaged and the pause
 * raised, the player ship `(x,y)`, the NPC `(x,y)`, and both hulls must not move
 * across several fire-interval-long frames (zero shots), with zero logged errors.
 *
 * It runs GREEN against the current build — confirming the live failure a tester
 * sees is a **stale Service Worker bundle** serving old combat code, not a logic
 * leak. The cache-busting half of Task 1 (per-build SW cache name) addresses that.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms — one fire cadence

/**
 * A controlled hostile that **drifts +X by 0.05 px/ms every frame it is ticked**.
 * Because `NpcShipManager.update` only advances each sprite while the turn runs
 * (and the active pause makes `isTurnRunning()` false), a frozen world is directly
 * observable as **zero drift** — and a real-time frame as a measurable one. The
 * shape covers every member the scene's per-frame path reads on a sprite
 * (`x`/`y`/`npc`/`aggressive`/`container.zIndex`/`mapColor` + the no-op lifecycle
 * predicates), so the wired scene drives it without error.
 */
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
    // NPC-vs-NPC engagement seam (manager calls these each frame) — no-ops here;
    // this stub drives its own drift in update() above.
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
  plannedRoute: { x: number; y: number } | null;
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

    // Engage a controlled fight just inside weapon range of the player ship.
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

    // CONTROL (real-time, short frames < the fire interval → no shot lands, so no
    // auto-pause): the wired scene actually maneuvers the ship AND advances the
    // NPC. This proves the freeze asserted below is a real halt, not a no-op.
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

    // FREEZE: raise the active pause — the same signal `onPlayerUnderAttack` raises
    // on an incoming hit.
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

    // Several fire-interval-long frames pass while the overlay is up: a frozen
    // world must move nothing and fire nothing — many cadences would otherwise
    // have produced shots and maneuvering.
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

  it("pauses immediately when the player initiates attack (no orbit before dialog)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPause } = scene;
    expect(physics).toBeTruthy();

    // Place the enemy inside weapon range so launchCombatWithNpc fires immediately.
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

    const shipBefore = { x: physics.shipX, y: physics.shipY };

    // Player initiates attack (the "Атаковать" button path).
    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    // Pause must be live immediately — BEFORE any NPC shot lands.
    expect(combatPause.paused).toBe(true);

    // Ship must be stopped: onStopShip is called from onPause during engagement.
    expect(physics.isMoving).toBe(false);

    // Several frames while the overlay is up: ship stays frozen.
    for (let i = 0; i < 5; i++) harness.tick(FIRE);
    expect(physics.shipX).toBe(shipBefore.x);
    expect(physics.shipY).toBe(shipBefore.y);
    expect(harness.errors()).toEqual([]);
  });

  it("starts the turn when the player initiates attack with no running turn (кружение не в момент хода)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPause } = scene;

    const enemy = makeDriftingHostile(
      "no-turn-foe",
      physics.shipX + 100,
      physics.shipY,
    );
    (npcManager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites.push(
      enemy,
    );

    // Precondition: turn is NOT running (the scenario the bug manifests in).
    scene.isTurnRunning = false;

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    // Pause must fire AND the turn must be started so orbit has a valid context
    // once "Огонь" lifts the pause — without this the ship orbits with no ход.
    expect(combatPause.paused).toBe(true);
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

    // Pre-existing route to some planet — simulates the player had clicked a
    // destination before switching to "Атаковать".
    scene.plannedRoute = { x: 9999, y: 8888 };

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    // The stale route must be cleared so pressing Space after "Огонь" doesn't
    // re-execute a route to the old destination instead of staying in combat.
    expect(scene.plannedRoute).toBeNull();
    expect(harness.errors()).toEqual([]);
  });

  it("stops orbiting when the player ends the turn mid-combat (Space = pause)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const { shipPhysics: physics, npcManager, combatPause } = scene;

    // Place enemy at exactly WEAPON_RANGE so the ship orbit keeps it in range.
    const WEAPON_RANGE = 240;
    const enemy = makeDriftingHostile(
      "orbit-pause-foe",
      physics.shipX + WEAPON_RANGE,
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

    expect(combatPause.paused).toBe(true);

    // Lift the pause — the player pressed "Огонь" and combat is now live.
    (combatPause as unknown as { resume(): void }).resume();
    expect(combatPause.paused).toBe(false);

    // Tick a few frames: the orbit should steer the ship toward the carrot.
    for (let i = 0; i < 3; i++) harness.tick(50);

    // Player presses Space — ends the turn: stop the ship and clear isTurnRunning.
    // endTurn() does both; we mirror that here so physics doesn't coast.
    physics.stop();
    scene.isTurnRunning = false;

    const posAfterPause = { x: physics.shipX, y: physics.shipY };

    // Several more frames: the orbit must NOT restart; ship holds position.
    for (let i = 0; i < 5; i++) harness.tick(50);

    expect(physics.shipX).toBe(posAfterPause.x);
    expect(physics.shipY).toBe(posAfterPause.y);
    expect(harness.errors()).toEqual([]);
  });

  it("freezes all fire when the player ends the turn mid-combat (Space = no shots)", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const {
      shipPhysics: physics,
      npcManager,
      combatModule,
      combatPause,
    } = scene;

    // Place enemy inside weapon range so fire would normally proceed.
    const enemy = makeDriftingHostile(
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

    expect(combatPause.paused).toBe(true);

    // Lift the overlay — combat is now live.
    (combatPause as unknown as { resume(): void }).resume();
    expect(combatPause.paused).toBe(false);

    const enemyHull0 = enemy.npc.hullHP;
    const playerHull0 = harness.player()!.ship.hullHP;

    // Player presses Space — ends the turn.
    physics.stop();
    scene.isTurnRunning = false;

    // Several fire-interval-long frames: no shots must land on either side.
    for (let i = 0; i < 5; i++) harness.tick(FIRE);

    expect(enemy.npc.hullHP).toBe(enemyHull0); // player didn't fire
    expect(harness.player()!.ship.hullHP).toBe(playerHull0); // NPC didn't fire
    expect(combatModule.isActive).toBe(true); // combat still engaged
    expect(harness.errors()).toEqual([]);
  });
});
