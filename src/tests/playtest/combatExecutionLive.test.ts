import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPlanningUi } from "@/presentation/flight/combatPlanningUi";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { CombatExecutionController } from "@/presentation/flight/combatExecution";
import type { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import type { PlanetManager } from "@/presentation/flight/PlanetManager";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { GAME_BALANCE, COMBAT_ROUND_MS, WRECK } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs;

function makeStaticHostile(
  id: string,
  x: number,
  y: number,
  opts: {
    hullHP?: number;
    shields?: number;
    role?: NpcRole;
    cruiseSpeed?: number;
  } = {},
): NpcShipSprite {
  const container = { x, y, zIndex: 100, rotation: 0, destroyed: false };
  const sprite = {
    x,
    y,
    container,
    aggressive: false,
    mapColor: 0xff0000,
    cruiseSpeed: opts.cruiseSpeed ?? 0,
    npc: {
      id,
      name: id,
      role: opts.role ?? NpcRole.PATROL,
      hullHP: opts.hullHP ?? 1_000_000,
      maxHull: opts.hullHP ?? 1_000_000,
      shields: opts.shields ?? 0,
      damage: 20,
      credits: 0,
      hostile: true,
      loadoutSummary: [],
    },
    update(): void {},
    destroy: () => {
      container.destroyed = true;
    },
    isGone: () => false,
    isLeaving: () => sprite.departed,
    isAnchored: () => false,
    departed: false,
    beginDeparture: () => {
      sprite.departed = true;
    },
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

function makeFriendly(id: string, x: number, y: number): NpcShipSprite {
  const s = makeStaticHostile(id, x, y, { role: NpcRole.TRADER });
  (s as unknown as { npc: { hostile: boolean; damage: number } }).npc.hostile =
    false;
  (s as unknown as { npc: { damage: number } }).npc.damage = 25;
  return s;
}

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: NpcShipManager;
  combatModule: CombatModule;
  combatPlanning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
  combatPlanningUi: CombatPlanningUi;
  combatExecution: CombatExecutionController;
  playerShip: PlayerShipRenderer;
  planetManager: PlanetManager;
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

function addBystander(scene: FlightPrivates, sprite: NpcShipSprite): void {
  (
    scene.npcManager as unknown as { npcSprites: NpcShipSprite[] }
  ).npcSprites.push(sprite);
}

describe("Execute-window mechanics live in the wired scene (14.5c)", () => {
  let harness: RealEngineHarness;
  let scene: FlightPrivates;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    scene = harness.currentScene() as unknown as FlightPrivates;
  });

  afterEach(() => {
    harness?.dispose();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  function spawnFoe(
    opts: Parameters<typeof makeStaticHostile>[3] = {},
    dx = 100,
  ): NpcShipSprite {
    const foe = makeStaticHostile(
      `foe-${Math.floor(scene.shipPhysics.shipX)}-${dx}`,
      scene.shipPhysics.shipX + dx,
      scene.shipPhysics.shipY,
      opts,
    );
    engage(scene, foe);
    expect(scene.combatPlanning.isPlanning).toBe(true);
    return foe;
  }

  it("afterburner: boost for exactly one window, wears the engine, reverts", () => {
    spawnFoe();
    expect(scene.combatPlanningUi.actionsOpen).toBe(true); // 14.5c action row
    scene.combatPlanningUi.toggleAction("afterburner");
    expect(scene.combatPlanning.plan.afterburner).toBe(true);
    const p = scene.shipPhysics;
    scene.combatPlanning.setDestination({ x: p.shipX + 250, y: p.shipY });

    scene.combatPlanning.confirm();
    expect(scene.combatExecution.windowBoostMultiplier).toBeGreaterThan(1);
    expect(scene.combatExecution.engineIntegrity).toBeLessThan(1);

    for (let i = 0; i < 32; i++) harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true);
    expect(scene.combatExecution.windowBoostMultiplier).toBe(1);
    expect(harness.errors()).toEqual([]);
  });

  it("gravity assist: passing a planet folds a boost into ShipPhysics velocity", () => {
    const planet = [...scene.planetManager.planetSprites].sort(
      (a, b) => b.displayRadius - a.displayRadius,
    )[0];
    expect(planet).toBeTruthy();
    const startX = planet.screenX + planet.displayRadius * 1.2;
    scene.shipPhysics.teleport(startX, planet.screenY);
    spawnFoe();
    scene.combatPlanning.setDestination({
      x: startX + 260,
      y: planet.screenY,
    });
    scene.combatPlanning.confirm();

    let maxSpeed = 0;
    for (let i = 0; i < 29; i++) {
      harness.tick(100);
      maxSpeed = Math.max(maxSpeed, scene.shipPhysics.currentSpeed);
    }
    expect(maxSpeed).toBeGreaterThan(scene.shipPhysics.getMaxSpeed() + 0.003);
    expect(harness.errors()).toEqual([]);
  });

  it("missile: a MISSILE-class planned shot travels, then lands on arrival", () => {
    const loadout = harness.engine.playerLoadout!;
    expect(loadout.install("wpn_rocket")).toBe(true);
    const foe = spawnFoe();
    scene.combatExecution.setRng(() => 0); // deterministic: always hits

    const rocket = scene.combatModule
      .fittedWeapons()
      .find((w) => w.id === "wpn_rocket")!;
    expect(rocket).toBeTruthy();
    scene.combatPlanningUi.armWeapon(rocket);
    expect(scene.combatPlanningUi.handleTargetClick(foe)).toBe(true);

    const hull0 = foe.npc.hullHP;
    scene.combatPlanning.confirm();
    for (let i = 0; i < 26; i++) harness.tick(100); // 2600ms > 2500ms launch
    expect(scene.combatExecution.missileCount).toBe(1);
    expect(foe.npc.hullHP).toBe(hull0); // in flight — nothing landed yet

    for (let i = 0; i < 4; i++) harness.tick(100);
    expect(scene.combatExecution.missileCount).toBe(0);
    expect(foe.npc.hullHP).toBeLessThan(hull0); // the arrival hit landed
    expect(harness.errors()).toEqual([]);
  });

  it("consumable shield restore: refills the player's shield pool at confirm", () => {
    const player = harness.player()!;
    player.inventory.addConsumable("con_shield_cell");
    player.ship.shields = 5;
    spawnFoe();
    scene.combatPlanningUi.toggleAction("con_shield_cell");
    expect(scene.combatPlanning.plan.consumableId).toBe("con_shield_cell");

    scene.combatPlanning.confirm();
    expect(player.ship.shields).toBe(player.ship.maxShields); // 5+120 clamps
    expect(player.inventory.hasConsumable("con_shield_cell")).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("consumable AoE: every enemy inside the blast radius takes the hit", () => {
    const player = harness.player()!;
    player.inventory.addConsumable("con_pulse_bomb");
    const near = spawnFoe({}, 100);
    const alsoNear = makeStaticHostile(
      "aoe-2",
      scene.shipPhysics.shipX - 120,
      scene.shipPhysics.shipY,
    );
    engage(scene, alsoNear);
    const h1 = near.npc.hullHP;
    const h2 = alsoNear.npc.hullHP;

    scene.combatPlanningUi.toggleAction("con_pulse_bomb");
    scene.combatPlanning.confirm();
    expect(near.npc.hullHP).toBeLessThan(h1);
    expect(alsoNear.npc.hullHP).toBeLessThan(h2);
    expect(harness.errors()).toEqual([]);
  });

  it("consumable weapon jam: the target's fire is suppressed for the window", () => {
    const player = harness.player()!;
    player.inventory.addConsumable("con_jammer");
    spawnFoe();
    scene.combatPlanningUi.toggleAction("con_jammer");
    const playerHull0 = player.ship.hullHP;

    scene.combatPlanning.confirm();
    for (let i = 0; i < 29; i++) harness.tick(100);
    expect(player.ship.hullHP).toBe(playerHull0);
    expect(harness.errors()).toEqual([]);
  });

  it("comms bribe: tribute moves through the bank and everyone disengages", () => {
    const player = harness.player()!;
    const foe = spawnFoe();
    const credits0 = player.credits;
    expect(credits0).toBeGreaterThan(0);

    scene.combatPlanningUi.toggleAction("bribe");
    scene.combatPlanning.confirm();
    expect(player.credits).toBeLessThan(credits0); // tribute paid via the bank
    expect(scene.combatModule.combatants.has(foe)).toBe(false);
    expect(foe.isLeaving()).toBe(true); // departs, never destroyed
    harness.tick(100); // emptied set resolves the fight
    expect(scene.combatModule.isActive).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("comms demand-surrender: a low-hull target yields (flees + drops loot); a healthy one refuses", () => {
    const weak = spawnFoe({ hullHP: 1000 });
    weak.npc.hullHP = 200;
    vi.spyOn(
      scene.npcManager as unknown as {
        rollDeathLootCount(): number;
      },
      "rollDeathLootCount",
    ).mockReturnValue(1);
    scene.combatPlanningUi.toggleAction("demand-surrender");
    scene.combatPlanning.confirm();
    expect(weak.isLeaving()).toBe(true);
    expect(scene.combatModule.combatants.has(weak)).toBe(false);
    harness.tick(100);
    expect(scene.combatModule.isActive).toBe(false);

    const strong = spawnFoe({ hullHP: 1_000_000 }, 140);
    scene.combatPlanningUi.toggleAction("demand-surrender");
    scene.combatPlanning.confirm();
    expect(strong.isLeaving()).toBe(false);
    expect(scene.combatModule.combatants.has(strong)).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("comms call-for-help: the nearest eligible friendly joins and fires at the hostile", () => {
    const foe = spawnFoe({}, 100);
    const ally = makeFriendly(
      "helper",
      scene.shipPhysics.shipX + 40,
      scene.shipPhysics.shipY + 30,
    );
    addBystander(scene, ally);

    scene.combatPlanningUi.toggleAction("call-for-help");
    const hull0 = foe.npc.hullHP;
    scene.combatPlanning.confirm();
    expect(scene.combatExecution.allyCount).toBe(1);

    for (let i = 0; i < 29; i++) harness.tick(100); // > one ally cadence (FIRE)
    expect(foe.npc.hullHP).toBeLessThan(hull0);
    expect(harness.errors()).toEqual([]);
  });

  it("banking: the player sprite rolls into a turning execute course, then levels", () => {
    spawnFoe();
    const p = scene.shipPhysics;
    scene.combatPlanning.setDestination({
      x: p.shipX - Math.cos(p.shipAngle) * 220,
      y: p.shipY - Math.sin(p.shipAngle) * 220,
    });
    scene.combatPlanning.confirm();
    const visual = scene.playerShip.container!;
    let maxRoll = 0;
    let minScaleY = 1;
    for (let i = 0; i < 20; i++) {
      harness.tick(50);
      maxRoll = Math.max(maxRoll, Math.abs(scene.combatExecution.bankingRoll));
      minScaleY = Math.min(minScaleY, visual.scale.y);
    }
    expect(maxRoll).toBeGreaterThan(0.05); // banks into the turn
    expect(minScaleY).toBeLessThan(1); // the transverse squash applied

    (scene.combatModule as unknown as { endCombat(): void }).endCombat();
    expect(scene.combatExecution.bankingRoll).toBe(0);
    expect(visual.scale.y).toBe(1);
    expect(harness.errors()).toEqual([]);
  });

  it("NPC shields absorb before hull and raise the shield-hit flash", () => {
    const foe = spawnFoe({ shields: 5000 });
    const gun = scene.combatModule.fittedWeapons()[0];
    scene.combatPlanningUi.armWeapon(gun);
    scene.combatPlanningUi.handleTargetClick(foe);
    const hull0 = foe.npc.hullHP;

    scene.combatPlanning.confirm();
    let maxFx = 0;
    for (let i = 0; i < 26; i++) {
      harness.tick(100); // past the 2500ms cadence
      maxFx = Math.max(maxFx, scene.combatExecution.shotFxCount);
    }
    expect(foe.npc.shields).toBeLessThan(5000); // the pool drained
    expect(foe.npc.hullHP).toBe(hull0); // hull untouched while shields hold
    expect(maxFx).toBeGreaterThan(0); // the styled shot path genuinely ran
    expect(harness.errors()).toEqual([]);
  });

  it("kill spawns a drifting wreck that emits the (deferred) loot along its drift", () => {
    vi.spyOn(
      scene.npcManager as unknown as { rollDeathLootCount(): number },
      "rollDeathLootCount",
    ).mockReturnValue(2);
    const foe = spawnFoe({ hullHP: 5, cruiseSpeed: 0.15 });
    const deathX = foe.x;
    const gun = scene.combatModule.fittedWeapons()[0];
    scene.combatPlanningUi.armWeapon(gun);
    scene.combatPlanningUi.handleTargetClick(foe);

    scene.combatPlanning.confirm();
    for (let i = 0; i < 26; i++) harness.tick(100); // the 2500ms shot kills
    expect(scene.combatExecution.wreckCount).toBe(1);
    const loot = (
      scene.npcManager as unknown as {
        loot: { spaceLoot: { id: string; x: number }[] };
      }
    ).loot;
    const foeLoot = () =>
      loot.spaceLoot.filter((i) => i.id.includes(foe.npc.id));
    expect(foeLoot().length).toBe(0); // instant dump DEFERRED to the drift

    for (const s of scene.npcManager.getNpcSpritesView()) {
      (s as unknown as { npc: { hostile: boolean } }).npc.hostile = false;
    }
    scene.shipPhysics.teleport(
      scene.shipPhysics.shipX - 2000,
      scene.shipPhysics.shipY - 2000,
    );
    for (
      let i = 0;
      i * 100 < WRECK.lifeMs * 2 && scene.combatExecution.wreckCount > 0;
      i++
    ) {
      if (scene.combatPlanning.isPlanning) scene.combatPlanning.confirm();
      harness.tick(100);
    }
    expect(scene.combatExecution.wreckCount).toBe(0); // despawned cleanly
    expect(foeLoot().length).toBe(2); // both staggered emissions fired
    for (const item of foeLoot()) {
      expect(item.x).toBeGreaterThan(deathX + 5); // dropped from the DRIFTED hull
    }
    expect(harness.errors()).toEqual([]);
  });

  it("PLANNING draws the player's own status bar even while the sim is frozen (Task 3)", () => {
    const player = harness.player()!;
    const foe = spawnFoe();
    expect(scene.combatPlanning.isPlanning).toBe(true);

    const spec = scene.combatExecution.playerStatusBarSpec();
    expect(spec).not.toBeNull();
    expect(spec!.hull).toBe(player.ship.hullHP);
    expect(spec!.maxHull).toBe(player.ship.maxHull);
    expect(spec!.shields).toBe(player.ship.shields);

    harness.tick(100);
    expect(scene.combatPlanning.isPlanning).toBe(true); // still frozen/planning
    expect(scene.combatExecution.statusBarCount).toBe(1);
    expect(scene.combatModule.combatants.has(foe)).toBe(true); // foe engaged…
    expect(harness.errors()).toEqual([]); // …but its bar is not drawn while planning
  });

  it("regression: EXECUTING still draws every combatant's bar plus the player's (Task 3)", () => {
    const foe = spawnFoe();
    scene.combatPlanning.confirm(); // → EXECUTING, the freeze lifts
    expect(scene.combatPlanning.isPlanning).toBe(false);

    harness.tick(100);
    expect(scene.combatExecution.statusBarCount).toBe(2);
    expect(scene.combatModule.combatants.has(foe)).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("round-length parity: the execute window still matches the balance constant", () => {
    expect(COMBAT_ROUND_MS).toBe(3000);
    expect(FIRE).toBeLessThan(2900);
  });
});
