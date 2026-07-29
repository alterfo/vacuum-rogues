/**
 * Task 14.5c (`docs/plans/20260713-tactical-pause-combat-rework.md`): the
 * execute-window mechanics are folded into the LIVE per-frame combat loop —
 * this pins the WIRING over the real engine, not the pure math (Tasks 4–14
 * unit-cover that):
 *
 * - afterburner boost applied for exactly one window + engine wear;
 * - gravity assist folding into `ShipPhysics.currentSpeed` near a planet;
 * - a missile-class gun launching a travel-time projectile that lands late;
 * - consumables: shield restore, AoE blast, weapon jam (NPC fire suppressed);
 * - comms: bribe (tribute + everyone disengages), demand-surrender
 *   (role/hull-gated), call-for-help (ally joins and fires);
 * - VFX wiring: banking roll on the player sprite, NPC shield absorb + flash,
 *   weapon-type shot fx, wreck + deferred staggered loot from the drift.
 */
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

// One player/NPC fire cadence (2500ms) — inside the 3000ms window, so a single
// window carries exactly one cadence tick.
const FIRE = GAME_BALANCE.combatFireIntervalMs;

/** Stationary controlled hostile (mirrors combatPlanningLiveWiring's stub). */
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
  };
  return sprite as unknown as NpcShipSprite;
}

/** Neutral friendly bystander (call-for-help candidate). */
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
    // A course, so the boosted window has real travel to amplify.
    const p = scene.shipPhysics;
    scene.combatPlanning.setDestination({ x: p.shipX + 250, y: p.shipY });

    scene.combatPlanning.confirm();
    expect(scene.combatExecution.windowBoostMultiplier).toBeGreaterThan(1);
    expect(scene.combatExecution.engineIntegrity).toBeLessThan(1);

    // The round timer re-opens planning — the boost reverts with the window.
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
    // Park just off the planet's surface, then fly a course past it.
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
    // Plain acceleration is clamped AT maxSpeed — only the slingshot exceeds it.
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
    // The rocket's cadence is cooldownTurns(2) × FIRE = 5000ms, pre-charged to
    // half on engagement — it launches 2500ms into the window. No instant
    // hit-scan damage may land at launch.
    for (let i = 0; i < 26; i++) harness.tick(100); // 2600ms > 2500ms launch
    expect(scene.combatExecution.missileCount).toBe(1);
    expect(foe.npc.hullHP).toBe(hull0); // in flight — nothing landed yet

    // 100px at MISSILE_COMBAT.speedPerMs (0.32) ≈ 313ms → lands by ~2820ms.
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
    // Without the jam the NPC's shot lands at FIRE (2500ms) — see the 14.5b
    // hold-fire test. Jammed (4000ms), the whole 2900ms window stays clean.
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
    // PATROL threshold 0.35 — 20% hull yields.
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

    // A healthy target refuses and the fight continues.
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

    // No weapon was assigned — the player's guns hold. Any damage is the ally's.
    for (let i = 0; i < 29; i++) harness.tick(100); // > one ally cadence (FIRE)
    expect(foe.npc.hullHP).toBeLessThan(hull0);
    expect(harness.errors()).toEqual([]);
  });

  it("banking: the player sprite rolls into a turning execute course, then levels", () => {
    spawnFoe();
    const p = scene.shipPhysics;
    // A destination behind the ship forces a hard arc → a visible bank.
    scene.combatPlanning.setDestination({
      x: p.shipX - Math.cos(p.shipAngle) * 220,
      y: p.shipY - Math.sin(p.shipAngle) * 220,
    });
    scene.combatPlanning.confirm();
    // Sample the roll AND the squash at their peak across the window: with the
    // confirm-time pursuit break-off (review 2026-07-15) the ship genuinely
    // flies the planned arc and levels out once the turn completes, so a
    // fixed-instant read after the arc would miss the applied squash.
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

    // The fight ends → the roll resets and the sprite levels out.
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
    // Track the peak across ticks (each fx expires after SHOT_FX_MS, so a
    // point-in-time read can miss it — the >= 0 it replaced was a tautology).
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
    // A fast dying ship so the wreck genuinely drifts.
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
    // Only THIS kill's items count — the live sim's own crossfire kills else-
    // where in the system may drop unrelated (legacy, undeferred) loot.
    const foeLoot = () =>
      loot.spaceLoot.filter((i) => i.id.includes(foe.npc.id));
    expect(foeLoot().length).toBe(0); // instant dump DEFERRED to the drift

    // The fight ended with the kill; the wreck keeps drifting + emitting. The
    // live sim would open fresh (unrelated) engagements mid-drift and freeze
    // the sim for planning — neutralize the bystanders so the drift window
    // ticks deterministically.
    for (const s of scene.npcManager.getNpcSpritesView()) {
      (s as unknown as { npc: { hostile: boolean } }).npc.hostile = false;
    }
    // Park the ship far away: the starter grav-tractor would otherwise scoop
    // the first drift emission the frame it spawns (a real pickup, not a bug).
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

    // The player's own bar spec is available and reflects the live ship.
    const spec = scene.combatExecution.playerStatusBarSpec();
    expect(spec).not.toBeNull();
    expect(spec!.hull).toBe(player.ship.hullHP);
    expect(spec!.maxHull).toBe(player.ship.maxHull);
    expect(spec!.shields).toBe(player.ship.shields);

    // A frozen-planning frame draws exactly ONE bar — the player's — and never
    // opens the execute loop (freeze semantics for NPC bars unchanged).
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
    // player (1) + the engaged hostile (1): the frozen-planning carve-out did
    // NOT alter the unfrozen full draw path.
    expect(scene.combatExecution.statusBarCount).toBe(2);
    expect(scene.combatModule.combatants.has(foe)).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("round-length parity: the execute window still matches the balance constant", () => {
    expect(COMBAT_ROUND_MS).toBe(3000);
    expect(FIRE).toBeLessThan(2900);
  });
});
