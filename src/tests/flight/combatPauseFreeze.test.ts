import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { CombatHud } from "@/presentation/flight/CombatHud";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

/**
 * The FTL-style active pause must freeze the *whole* fight — not just stop new
 * shots. Three fire/projectile paths have to honour the single `isFrozen()` gate:
 *  - the player multi-weapon fire loop (`advancePlayerWeapons`),
 *  - the NPC fire loop (`advanceNpcTimers`), and
 *  - **tracers already in flight** — the escaping path the plan called out.
 *
 * The Task 1 regression below is the in-flight-tracer repro: before the fix,
 * {@link CombatModule.update} advanced the HUD tracers (`this.hud?.update(...)`)
 * at the *top* of the frame, **before** the freeze early-return, so a projectile
 * launched the instant before the pause kept streaking toward its target while the
 * world was supposed to be frozen. Task 2 gates that advance on `!isFrozen()`, so
 * the test now asserts the frozen behaviour as a plain `it` (green regression).
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics;
}

function makeSprite(
  id: string,
  x: number,
  y: number,
  damage = 20,
): NpcShipSprite {
  return {
    x,
    y,
    npc: { id, name: id, hullHP: 100, maxHull: 100, damage },
  } as unknown as NpcShipSprite;
}

/**
 * A {@link CombatModule} wired with render layers (so the HUD spawns traveling
 * tracers) and a *manually controllable* active-pause flag. The first volley
 * fires while unpaused, leaving tracers in flight; flipping `paused` then lets us
 * assert the whole world — fire **and** projectiles — freezes.
 */
function makePausableFight(): {
  module: CombatModule;
  hud: CombatHud;
  ship: { hullHP: number; maxHull: number };
  enemy: NpcShipSprite;
  setPaused: (p: boolean) => void;
} {
  let paused = false;
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // dmg 14, range 240
  const uiLayer = new Container();
  const gameLayer = new Container();
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(0, 0),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    getUiLayer: () => uiLayer,
    getGameLayer: () => gameLayer,
    getScreenSize: () => ({ width: 800, height: 600 }),
    isPaused: () => paused,
  };
  const module = new CombatModule(deps);
  module.initialize();
  const enemy = makeSprite("a", 50, 0, 20); // in pulse range (240) + NPC weapon range
  module.addCombatant(enemy); // auto-selects `enemy` as the player's target
  const hud = (module as unknown as { hud: CombatHud }).hud;
  return { module, hud, ship, enemy, setPaused: (p) => (paused = p) };
}

describe("combat freezes fully during the active pause", () => {
  it("freezes an in-flight tracer while paused (the escaping projectile)", () => {
    const { module, hud, setPaused } = makePausableFight();

    // First volley fires while unpaused → player + NPC tracers spawn (age 0).
    module.update(FIRE);
    expect(hud.tracerStates.length).toBeGreaterThan(0);

    // Snapshot every live tracer, then pause the world.
    const before = hud.tracerStates.map((t) => ({
      age: t.age,
      x: t.pos.x,
      y: t.pos.y,
    }));
    setPaused(true);

    // Several frames pass while the overlay is open — a frozen world must not
    // advance any projectile already in flight (no travel).
    module.update(16);
    module.update(16);
    module.update(16);

    const after = hud.tracerStates.map((t) => ({
      age: t.age,
      x: t.pos.x,
      y: t.pos.y,
    }));
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].age).toBe(before[i].age); // frozen — no travel
      expect(after[i].x).toBe(before[i].x);
      expect(after[i].y).toBe(before[i].y);
    }
  });

  it("fires no player or NPC shot while paused (no new tracers, no damage)", () => {
    const { module, hud, ship, enemy, setPaused } = makePausableFight();
    // Pause before any fire cadence elapses: a fully frozen world must emit no
    // shot at all, however many fire-interval-long frames pass.
    setPaused(true);
    for (let i = 0; i < 5; i++) module.update(FIRE);

    expect(hud.tracerStates.length).toBe(0); // no shot ever spawned a tracer
    expect(ship.hullHP).toBe(100); // NPC never fired → player hull untouched
    expect(enemy.npc.hullHP).toBe(100); // player never fired → enemy hull untouched
  });

  it("resumes player + NPC fire on cadence once unpaused", () => {
    const { module, hud, ship, enemy, setPaused } = makePausableFight();

    // Paused: the fire timers are frozen too (update returns before advancing
    // them), so two interval-long frames still produce nothing.
    setPaused(true);
    module.update(FIRE);
    module.update(FIRE);
    expect(enemy.npc.hullHP).toBe(100);
    expect(ship.hullHP).toBe(100);

    // Unpause: one fire interval later both weapons fire on cadence again.
    setPaused(false);
    module.update(FIRE);
    expect(enemy.npc.hullHP).toBeLessThan(100); // player shot landed
    expect(ship.hullHP).toBeLessThan(100); // NPC shot landed
    expect(hud.tracerStates.length).toBeGreaterThan(0);
  });
});
