/**
 * Task 14.5b (`docs/plans/20260713-tactical-pause-combat-rework.md`): the
 * planning-phase UI + planned per-weapon targeting are live in the wired flight
 * scene — this pins the WIRING over the real engine, not the pure math (Tasks
 * 2–7 unit-cover that):
 *
 * - engaging a fight mounts the weapon bar + range rings (and re-mounts them on
 *   the next planning round);
 * - the two-step weapon→target assignment writes into the live planned-turn
 *   draft, and the confirmed turn's execute window fires AT the assigned target;
 * - an EMPTY confirmed plan holds the player's fire for the whole window (the
 *   "unassigned = hold fire" rule, Task 6) while NPC return fire still lands —
 *   the legacy nearest-in-range auto-fire is no longer the in-loop behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPlanningUi } from "@/presentation/flight/combatPlanningUi";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { GAME_BALANCE, COMBAT_ROUND_MS } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

// One player fire cadence — the 2900ms window ticks below must exceed it so a
// legacy nearest-in-range auto-fire (the pre-14.5b behaviour) WOULD have shot.
const FIRE = GAME_BALANCE.combatFireIntervalMs;

/** Stationary controlled hostile (mirrors combatPauseFreezesLiveFight's stub). */
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
  combatPlanning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
  combatPlanningUi: CombatPlanningUi;
}

function engage(scene: FlightPrivates, foe: NpcShipSprite): void {
  (
    scene.npcManager as unknown as { npcSprites: NpcShipSprite[] }
  ).npcSprites.push(foe);
  (
    scene.npcManager as unknown as {
      launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
    }
  ).launchCombatWithNpc(foe.npc);
}

describe("Planning-phase UI + planned targeting live in the wired scene (14.5b)", () => {
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

  it("mounts the weapon bar + rings on engagement, unmounts during EXECUTING, remounts next round", () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const foe = makeStaticHostile(
      "ui-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);

    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.combatPlanningUi.isOpen).toBe(true); // starter loadout has a gun

    scene.combatPlanning.confirm();
    expect(scene.combatPlanningUi.isOpen).toBe(false); // torn down for the window

    // The round timer re-opens planning on its own — the surface comes back.
    for (let i = 0; i < 32; i++) harness.tick(100); // 3200ms > COMBAT_ROUND_MS
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.combatPlanningUi.isOpen).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("fires at the ASSIGNED target during the execute window (two-step assignment live)", () => {
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const foe = makeStaticHostile(
      "assigned-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    // Two-step assignment through the live UI: arm the fitted gun, click the foe.
    const gun = scene.combatModule.fittedWeapons()[0];
    expect(gun).toBeTruthy();
    scene.combatPlanningUi.armWeapon(gun);
    expect(scene.combatPlanningUi.handleTargetClick(foe)).toBe(true);
    expect(scene.combatPlanning.plan.weaponTargets.get(gun)).toBe(foe);

    const hull0 = foe.npc.hullHP;
    scene.combatPlanning.confirm();
    expect(scene.combatPlanning.isExecuting).toBe(true);
    for (let i = 0; i < 29; i++) harness.tick(100); // 2900ms: > FIRE, < ROUND_MS

    expect(foe.npc.hullHP).toBeLessThan(hull0); // the planned shot landed
    expect(harness.errors()).toEqual([]);
  });

  it("holds ALL player fire on an empty confirmed plan (unassigned = hold fire, live)", () => {
    const scene = harness.currentScene() as unknown as FlightPrivates;
    const foe = makeStaticHostile(
      "hold-fire-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    const hull0 = foe.npc.hullHP;
    const playerHull0 = harness.player()!.ship.hullHP;
    scene.combatPlanning.confirm(); // EMPTY plan — hold position, hold fire

    // Tick out (almost) the whole window: several player cadences would have
    // fired under the legacy nearest-in-range auto-fire.
    for (let i = 0; i < 29; i++) harness.tick(100); // 2900ms < COMBAT_ROUND_MS
    expect(scene.combatPlanning.isExecuting).toBe(true);

    expect(foe.npc.hullHP).toBe(hull0); // player guns held fire
    expect(harness.player()!.ship.hullHP).toBeLessThan(playerHull0); // NPC fire still real-time
    expect(harness.errors()).toEqual([]);
  });

  it("routes a planning-phase left-click to the movement preview despite the running turn (click-order regression)", () => {
    // Engagement holds `isTurnRunning` open, and onPointerDown's turn-running
    // guard ("⏸ Поставь на паузу…") used to sit BEFORE the planning branch —
    // so a live planning movement click could never reach previewCombatCourse.
    // The planning branch must win while the sim is frozen for planning.
    const scene = harness.currentScene() as unknown as FlightPrivates & {
      onPointerDown(e: unknown): void;
      sceneReadyAt: number;
      isTurnRunning: boolean;
    };
    const foe = makeStaticHostile(
      "click-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.isTurnRunning).toBe(true); // the guard that swallowed the click

    scene.sceneReadyAt = -10_000; // clear of the scene-entry input grace window
    scene.onPointerDown({
      button: 0,
      shiftKey: false,
      pointerType: "mouse",
      global: { x: 400, y: 300 },
      preventDefault: () => {},
    } as never);

    expect(scene.combatPlanning.plan.destination).not.toBeNull(); // preview took the click
    expect(harness.errors()).toEqual([]);
  });

  it("COMBAT_ROUND_MS parity guard: the wired round length is the balance constant", () => {
    // The playtest ticks above encode 2900ms/3200ms boundaries — pin the
    // constants so a balance retune consciously revisits them: the window must
    // outlast one player fire cadence, else the hold-fire test proves nothing.
    expect(COMBAT_ROUND_MS).toBe(3000);
    expect(FIRE).toBeLessThan(2900);
  });
});
