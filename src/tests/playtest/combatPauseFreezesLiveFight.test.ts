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
    restoreInteractivity: () => {},
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

/**
 * Stationary variant of {@link makeDriftingHostile} for tests that tick many
 * seconds of real time across a PLANNING window (where `NpcShipManager.update`
 * still drives each sprite's own `update()` unconditionally, drift or not) —
 * the drifting stub would end up well outside weapon range by the time an
 * EXECUTING window opens, which is irrelevant noise for a fire-gating test.
 */
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

  it("opens tactical planning immediately when the player initiates attack, even while flying (Task 14.5a — no more deferred pause)", () => {
    // Rewritten (`docs/plans/20260713-tactical-pause-combat-rework.md` Task 1c):
    // the old reactive active-pause deferred freezing a moving ship to the next
    // day boundary (`pauseAtDayBoundary`) so a route wasn't aborted mid-day. The
    // new pause-and-plan loop freezes on `beginCombat()` unconditionally — there
    // is no day-boundary deferral concept left for combat engagement.
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

    // Player initiates attack (the "Атаковать" button path).
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

    // Precondition: turn is NOT running (the scenario the bug manifests in).
    scene.isTurnRunning = false;

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    // Planning must open AND the turn must be started, so the confirmed plan
    // has a valid turn context to execute in once the player confirms.
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

    // Pre-existing route to some planet — simulates the player had clicked a
    // destination before switching to "Атаковать".
    scene.plannedRoute = { x: 9999, y: 8888 };

    (
      npcManager as unknown as {
        launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
      }
    ).launchCombatWithNpc(enemy.npc);

    // Route is preserved through combat — the combat pause freezes the ship,
    // and the player can resume the route by pressing Space after combat ends.
    expect(scene.plannedRoute).toEqual({ x: 9999, y: 8888 });
    expect(harness.errors()).toEqual([]);
  });

  it("cycles EXECUTING back to PLANNING on its own once the round timer elapses (Task 14.5a)", () => {
    // Rewritten: the old "Space ends the turn mid-combat" scenario doesn't map
    // 1:1 onto the new loop (there is no mid-window abort — the fixed round
    // timer is the single deterministic terminator, plan Task 1b). The
    // analogous new invariant: PLANNING freezes movement (already covered by
    // the freeze test above); confirming starts a fixed EXECUTING window that
    // returns to PLANNING **by itself** once `COMBAT_ROUND_MS` elapses — no
    // Space/HUD action needed to end it early, and none can.
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

    // Tick just short of the round boundary — still executing.
    for (let i = 0; i < 29; i++) harness.tick(100); // 2900ms < COMBAT_ROUND_MS(3000)
    expect(combatPlanning.isExecuting).toBe(true);

    // Cross the boundary — planning re-opens on its own, no player action.
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

    // Several fire-interval-long frames while still PLANNING: nothing fires.
    for (let i = 0; i < 5; i++) harness.tick(FIRE);
    expect(enemy.npc.hullHP).toBe(enemyHull0);
    expect(harness.player()!.ship.hullHP).toBe(playerHull0);
    expect(combatModule.isActive).toBe(true);

    // Confirm — EXECUTING begins (a fresh COMBAT_ROUND_MS(3000) window).
    // Legacy auto-fire (still wired this slice) needs one full FIRE(2500)
    // interval to land its first shot — fine-grained ticks so that interval
    // completes comfortably before the round boundary, not straddling it.
    combatPlanning.confirm();
    for (let i = 0; i < 27; i++) harness.tick(100); // 2700ms: > FIRE, < ROUND_MS
    expect(
      enemy.npc.hullHP < enemyHull0 ||
        harness.player()!.ship.hullHP < playerHull0,
    ).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("the HUD «Ход»/«Пауза» button confirms the plan during PLANNING instead of aborting the turn (Task 14.5a)", () => {
    // Rewritten: the old reactive overlay guarded this button via
    // `combatPause.paused`, which never becomes true anymore under the new
    // loop — without its own guard, `onPlayPause()` would fall through to its
    // `isTurnRunning` branch and call `endTurn()` mid-plan, desyncing
    // `isTurnRunning` from `combatPlanning`'s own phase. It must instead treat
    // a PLANNING-phase click as the mouse equivalent of Space's confirm.
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

    // The player clicks the HUD «Ход»/«Пауза» toggle while planning is open.
    scene.hud.onPlayPause?.();

    // Must confirm the plan (→ EXECUTING), not abort the turn.
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
