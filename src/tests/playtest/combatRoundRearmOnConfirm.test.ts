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
