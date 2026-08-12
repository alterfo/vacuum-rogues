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

const FIRE = GAME_BALANCE.combatFireIntervalMs;

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

    for (let i = 0; i < 29; i++) harness.tick(100); // 2900ms < COMBAT_ROUND_MS
    expect(scene.combatPlanning.isExecuting).toBe(true);

    expect(foe.npc.hullHP).toBe(hull0); // player guns held fire
    expect(harness.player()!.ship.hullHP).toBeLessThan(playerHull0); // NPC fire still real-time
    expect(harness.errors()).toEqual([]);
  });

  it("routes a planning-phase left-click to the movement preview despite the running turn (click-order regression)", () => {
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
    expect(COMBAT_ROUND_MS).toBe(3000);
    expect(FIRE).toBeLessThan(2900);
  });
});
