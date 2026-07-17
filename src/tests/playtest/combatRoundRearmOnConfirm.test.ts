/**
 * Review 2026-07-15 (second pass) regression: each confirmed planning turn must
 * re-arm the round-based incoming-damage budget (`CombatModule.beginCombatRound`).
 *
 * The round latch (`roundComplete`) halts BOTH sides' fire once cumulative
 * incoming damage reaches `combatRoundHullFraction` (~34%) of max hull. In the
 * old reactive-pause flow the resume path re-armed it; the pause-and-plan loop
 * unwired that path (`onRoundComplete` deliberately dropped in
 * `combatModuleDeps.ts`) but nothing on the live confirm path called
 * `beginCombatRound()` again — so after ~34% hull damage every later execute
 * window was a permanent zero-fire no-op: the fight could never be won by
 * shooting. Headless gates missed it because `PlayerAgent` re-arms the round
 * itself each combat step; a live human/autopilot fight soft-locked.
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

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** Stationary controlled hostile (combatPlanningLoopGuards' stub shape). */
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

/** Arm the starter gun and assign it to `foe` through the live planning UI. */
function assignGun(scene: FlightPrivates, foe: NpcShipSprite): void {
  const gun = scene.combatModule.fittedWeapons()[0];
  expect(gun).toBeTruthy();
  scene.combatPlanningUi.armWeapon(gun);
  expect(scene.combatPlanningUi.handleTargetClick(foe)).toBe(true);
}

describe("Confirmed planning turn re-arms the round budget (review 2026-07-15)", () => {
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

  it("a spent round budget does not silence the next confirmed window's fire", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "latch-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    // A prior window spent this round's incoming-damage budget: the latch is
    // set and fire is halted. Nothing but beginCombatRound() clears it.
    scene.combatModule.roundComplete = true;

    assignGun(scene, foe);
    scene.combatPlanning.confirm();

    // Confirm = a fresh round: the latch must re-arm at the window boundary…
    expect(scene.combatModule.roundComplete).toBe(false);

    // …and the planned shot must actually land inside the window.
    const hull0 = foe.npc.hullHP;
    for (let i = 0; i < 28; i++) harness.tick(100); // 2800ms > fire cadence
    expect(foe.npc.hullHP).toBeLessThan(hull0);
    expect(harness.errors()).toEqual([]);
  });
});

describe("An in-flight continuing course does NOT re-arm the round budget (win-rate-100pct plan, Task 6 — root-cause fix)", () => {
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

  it("re-confirming with NO new destination while the ship is still moving keeps a spent round budget spent — a committed crossing costs ONE round, not one per re-opened window", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "crossing-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    // Window 1: a GENUINE flee — an explicit destination far from the fight,
    // through the real `breakOffCombatPursuit()` seam (mirrors a player/agent
    // plotting an escape route while already engaged; `isMoving` alone is not
    // a safe signal — ordinary standing combat's own auto-orbit also keeps
    // `isMoving` true, see `beginWindow`'s hardening doc comment — so this
    // must be a REAL route, not a stubbed physics flag).
    assignGun(scene, foe);
    scene.combatPlanning.setDestination({
      x: scene.shipPhysics.shipX + 100_000,
      y: scene.shipPhysics.shipY,
    });
    scene.combatPlanning.confirm(); // window 1 — the fresh engagement always arms
    expect(scene.combatModule.roundComplete).toBe(false);

    // This window's budget got spent (e.g. a garrison volley landed).
    scene.combatModule.roundComplete = true;

    // Let the fixed-duration window elapse so PLANNING re-opens with a fresh
    // (empty) draft — mirrors `PlayerAgent.completeWarp`'s own per-tick
    // re-confirm loop while flying an unbroken course to the system boundary.
    for (let i = 0; i < 31; i++) harness.tick(100); // 3100ms > COMBAT_ROUND_MS (3000)
    expect(scene.combatPlanning.isPlanning).toBe(true);
    // The far destination is nowhere near reached — the ship is genuinely
    // still mid-transit (real physics, not stubbed) and the real auto-pursuit
    // is still yielding to it.
    expect(scene.shipPhysics.isMoving).toBe(true);

    // Re-confirming weapons with NO new destination — the "destination
    // untouched" convention — must NOT re-arm the already-spent budget.
    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 2 — no destination, still in flight
    expect(scene.combatModule.roundComplete).toBe(true); // still spent, not re-armed
  });

  it("setting an explicit new destination this window still re-arms — only an unredirected in-flight continuation is exempt", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "retarget-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 1
    scene.combatModule.roundComplete = true;

    for (let i = 0; i < 31; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    // A genuinely new tactical decision this window — an explicit new
    // destination — even though the ship is still moving.
    scene.shipPhysics.isMoving = true;
    assignGun(scene, foe);
    scene.combatPlanning.setDestination({
      x: scene.shipPhysics.shipX,
      y: scene.shipPhysics.shipY + 500,
    });
    scene.combatPlanning.confirm(); // window 2 — a freshly-set course
    expect(scene.combatModule.roundComplete).toBe(false); // re-armed, unlike the unredirected continuation case
  });

  it("re-confirming with NO destination while STATIONARY (standing to fight) still re-arms every window — ordinary combat is unaffected", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "stand-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 1, no destination
    scene.combatModule.roundComplete = true;

    for (let i = 0; i < 31; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true);

    scene.shipPhysics.isMoving = false; // holding position, not fleeing
    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 2, still no destination
    expect(scene.combatModule.roundComplete).toBe(false); // re-armed — a stationary fight never gets the crossing exemption
  });

  it("ordinary standing combat re-arms every window even though the REAL auto-orbit sets isMoving=true on its own — isMoving alone is not a safe signal (round-budget hardening)", () => {
    const scene = flightScene();
    const foe = makeStaticHostile(
      "orbit-foe",
      scene.shipPhysics.shipX + 100,
      scene.shipPhysics.shipY,
    );
    engage(scene, foe);
    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 1, no destination, no route ever plotted
    scene.combatModule.roundComplete = true;

    // Let the window run out for real (no manual isMoving stubbing anywhere in
    // this test): the combat auto-orbit (`CombatPursuitController.
    // steerCombatOrbit`) keeps circle-strafing the foe to hold weapon range,
    // which — by design — keeps calling `physics.setPath()` every unfrozen
    // frame and so leaves `isMoving === true` at the window boundary, exactly
    // like a genuine flee would. Verified live: this is NOT a synthetic setup.
    for (let i = 0; i < 31; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.shipPhysics.isMoving).toBe(true); // the orbit, not a stub

    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 2, still no destination
    // Must still re-arm: the auto-pursuit was never suspended (no route was
    // ever plotted), so `isPursuitSuspended()` is false despite `isMoving`
    // being true — the exemption must not fire.
    expect(scene.combatModule.roundComplete).toBe(false);
  });
});
