/**
 * Review 2026-07-15 regressions for the pause-and-plan combat loop wiring
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`) — each pins a live
 * scene bug the 14.5/15 suites missed:
 *
 * 1. a confirmed planned DESTINATION must actually fly: the combat
 *    auto-pursuit used to re-`setPath` its orbit carrot every unfrozen frame,
 *    clobbering the planned course (kiting/gravity-pass plans were cosmetic);
 * 2. PLANNING freezes NPC movement (Task 1b's whole-sim freeze) — hostiles
 *    used to keep flying while the player planned;
 * 3. the HUD «Ход»/«Пауза» button mid-execute-window must be a no-op — its
 *    combat-abort `endTurn()` froze `CombatModule` (`isPaused` includes
 *    `!isTurnRunning`) while the round clock kept cycling: a permanent
 *    zero-fire planning loop with no recovery gesture;
 * 4. an `endTurn()` landing mid-window from ANY path (the low-hull auto-stop
 *    class) must not freeze the fight — the window runs on the round timer;
 * 5. a REFUSED engagement (weaponless ship) must not open the planning
 *    freeze — no fight ever becomes active to end it, so the freeze would
 *    soft-lock the sim.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPlanningUi } from "@/presentation/flight/combatPlanningUi";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { gearById, GearKind } from "@/systems/equipment/GearCatalog";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** Stationary controlled hostile that COUNTS its movement-advance calls
 *  (mirrors combatPlanningLiveWiring's stub + an `updates` probe). */
function makeStaticHostile(
  id: string,
  x: number,
  y: number,
): NpcShipSprite & { updates: number } {
  const container = { x, y, zIndex: 100 };
  const sprite = {
    x,
    y,
    container,
    updates: 0,
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
    update(): void {
      sprite.updates++;
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
  };
  return sprite as unknown as NpcShipSprite & { updates: number };
}

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: NpcShipManager;
  combatModule: CombatModule;
  combatPlanning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
  combatPlanningUi: CombatPlanningUi;
  isTurnRunning: boolean;
  onPlayPause(): void;
  endTurn(): void;
  hud: { setTurnRunning(running: boolean): void };
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

/** Arm the starter gun and assign it to `foe` through the live planning UI. */
function assignGun(scene: FlightPrivates, foe: NpcShipSprite): void {
  const gun = scene.combatModule.fittedWeapons()[0];
  expect(gun).toBeTruthy();
  scene.combatPlanningUi.armWeapon(gun);
  expect(scene.combatPlanningUi.handleTargetClick(foe)).toBe(true);
}

describe("Pause-and-plan loop guards live in the wired scene (review 2026-07-15)", () => {
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

  function flightScene(): FlightPrivates {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    return harness.currentScene() as unknown as FlightPrivates;
  }

  it("flies the confirmed planned destination — the orbit-strafe must not clobber it", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "dest-foe",
      scene.shipPhysics.shipX + 100, // inside weapon range → orbit would engage
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    const dest = {
      x: scene.shipPhysics.shipX,
      y: scene.shipPhysics.shipY + 600, // perpendicular to the foe line
    };
    scene.combatPlanning.setDestination(dest);
    scene.combatPlanning.confirm();

    // A combat target IS selected, so without the confirm-time break-off the
    // pursuit re-setPaths its far orbit carrot on the very next frame.
    expect(scene.combatModule.selectedTarget).toBe(foe);
    for (let i = 0; i < 5; i++) harness.tick(100);
    expect(scene.combatPlanning.isExecuting).toBe(true);
    expect(scene.shipPhysics.getTargetX()).toBeCloseTo(dest.x, 0);
    expect(scene.shipPhysics.getTargetY()).toBeCloseTo(dest.y, 0);
    expect(harness.errors()).toEqual([]);
  });

  it("freezes NPC movement during PLANNING and resumes it in the execute window", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "freeze-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    for (let i = 0; i < 5; i++) harness.tick(100);
    expect(foe.updates).toBe(0); // whole-sim freeze: the hostile holds still

    scene.combatPlanning.confirm();
    for (let i = 0; i < 5; i++) harness.tick(100);
    expect(foe.updates).toBeGreaterThan(0); // real-time again inside the window
    expect(harness.errors()).toEqual([]);
  });

  it("the HUD button reads «Ход» during PLANNING, not a stale «Пауза» (2026-07-18)", () => {
    const scene = flightScene();
    scene.isTurnRunning = true; // a turn was already running when combat interrupted it
    const spy = vi.spyOn(scene.hud, "setTurnRunning");
    const foe = makeStaticHostile(
      "label-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    harness.tick(100);
    expect(spy).toHaveBeenLastCalledWith(false); // «Ход», ready to confirm — never «Пауза»
    expect(harness.errors()).toEqual([]);
  });

  it("«Ход»/«Пауза» mid-window is a no-op: no turn abort, the fight keeps firing", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "pause-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    assignGun(scene, foe);
    scene.combatPlanning.confirm();
    harness.tick(100);

    scene.onPlayPause(); // used to endTurn() → permanent zero-fire wedge
    expect(scene.isTurnRunning).toBe(true);
    expect(scene.combatPlanning.isExecuting).toBe(true);

    const hull0 = foe.npc.hullHP;
    for (let i = 0; i < 28; i++) harness.tick(100); // 2900ms: > fire cadence
    expect(foe.npc.hullHP).toBeLessThan(hull0); // the planned shot still landed
    expect(harness.errors()).toEqual([]);
  });

  it("a stray endTurn() mid-window (low-hull auto-stop class) doesn't freeze the fight", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "endturn-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    assignGun(scene, foe);
    scene.combatPlanning.confirm();
    harness.tick(100);

    scene.endTurn(); // any mid-window endTurn path — the window must survive it
    const hull0 = foe.npc.hullHP;
    for (let i = 0; i < 28; i++) harness.tick(100); // window still running
    expect(scene.combatPlanning.isExecuting).toBe(true);
    expect(foe.npc.hullHP).toBeLessThan(hull0); // fire never froze

    for (let i = 0; i < 5; i++) harness.tick(100); // past COMBAT_ROUND_MS
    expect(scene.combatPlanning.isPlanning).toBe(true); // loop cycles on
    expect(harness.errors()).toEqual([]);
  });

  it("a weaponless ship's refused engagement never opens the planning freeze", () => {
    const scene = flightScene();
    const loadout = harness.engine.playerLoadout;
    expect(loadout).toBeTruthy();
    const slots = loadout!.installedSlots();
    for (let i = slots.length - 1; i >= 0; i--) {
      if (gearById(slots[i].gearId)?.kind === GearKind.WEAPON)
        loadout!.removeAt(i);
    }
    expect(scene.combatModule.fittedWeapons()).toEqual([]);

    const foe = makeStaticHostile(
      "noweapon-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);

    expect(scene.combatModule.isActive).toBe(false); // engagement refused
    expect(scene.combatPlanning.isPlanning).toBe(false); // freeze never opened
    for (let i = 0; i < 5; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(false); // and stays closed
    expect(harness.errors()).toEqual([]);
  });
});
