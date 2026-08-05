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

    scene.combatModule.roundComplete = true;

    assignGun(scene, foe);
    scene.combatPlanning.confirm();

    expect(scene.combatModule.roundComplete).toBe(false);

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

    assignGun(scene, foe);
    scene.combatPlanning.setDestination({
      x: scene.shipPhysics.shipX + 100_000,
      y: scene.shipPhysics.shipY,
    });
    scene.combatPlanning.confirm(); // window 1 — the fresh engagement always arms
    expect(scene.combatModule.roundComplete).toBe(false);

    scene.combatModule.roundComplete = true;

    for (let i = 0; i < 31; i++) harness.tick(100); // 3100ms > COMBAT_ROUND_MS (3000)
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.shipPhysics.isMoving).toBe(true);

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

    for (let i = 0; i < 31; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.shipPhysics.isMoving).toBe(true); // the orbit, not a stub

    assignGun(scene, foe);
    scene.combatPlanning.confirm(); // window 2, still no destination
    expect(scene.combatModule.roundComplete).toBe(false);
  });
});
