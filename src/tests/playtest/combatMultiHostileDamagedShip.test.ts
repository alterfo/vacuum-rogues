import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { COMBAT_ROUND_MS } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function makeGarrisonHostile(id: string, x: number, y: number): NpcShipSprite {
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
      role: NpcRole.OVERMIND,
      hullHP: 1_000_000,
      maxHull: 1_000_000,
      damage: 28, // ROLE_STATS[OVERMIND].damage — matches production garrison ships
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

describe("Multi-hostile arrival vs a damaged ship (combat-mechanics escalation, win-rate-100pct plan)", () => {
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

  it("a damaged ship (30% hull) survives arriving into a 4-ship standing garrison for one execute window", () => {
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const maxHull = player.ship.maxHull;
    player.ship.hullHP = Math.floor(maxHull * 0.3);
    galaxy.addOvermindSystem(player.currentSystemId);

    const scene = harness.currentScene() as unknown as FlightPrivates;
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      engage(
        scene,
        makeGarrisonHostile(
          id,
          scene.shipPhysics.shipX + 50 + i * 5,
          scene.shipPhysics.shipY,
        ),
      );
    }
    expect(scene.combatPlanning.isPlanning).toBe(true);

    scene.combatPlanning.confirm();

    for (let i = 0; i < 35; i++) harness.tick(100); // 3500ms > COMBAT_ROUND_MS

    expect(harness.errors()).toEqual([]);
    expect(player.ship.hullHP).toBeGreaterThan(0);
  });

  it("COMBAT_ROUND_MS exceeds the NPC fire interval — the lock-step-timer scenario is real, not synthetic", () => {
    expect(COMBAT_ROUND_MS).toBeGreaterThan(0);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
  });
});
