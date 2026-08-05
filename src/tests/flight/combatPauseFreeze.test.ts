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

    module.update(FIRE);
    expect(hud.tracerStates.length).toBeGreaterThan(0);

    const before = hud.tracerStates.map((t) => ({
      age: t.age,
      x: t.pos.x,
      y: t.pos.y,
    }));
    setPaused(true);

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

  it("resumes an in-flight tracer's travel once unpaused", () => {
    const { module, hud, setPaused } = makePausableFight();

    module.update(FIRE);
    expect(hud.tracerStates.length).toBeGreaterThan(0);

    setPaused(true);
    module.update(16);
    const frozen = hud.tracerStates.map((t) => ({
      age: t.age,
      x: t.pos.x,
      y: t.pos.y,
    }));
    expect(frozen.length).toBeGreaterThan(0);

    setPaused(false);
    module.update(16);
    const resumed = hud.tracerStates.map((t) => ({
      age: t.age,
      x: t.pos.x,
      y: t.pos.y,
    }));
    expect(resumed.length).toBe(frozen.length);
    for (let i = 0; i < frozen.length; i++) {
      expect(resumed[i].age).toBeGreaterThan(frozen[i].age); // travel resumed
    }
    expect(
      resumed.some((r, i) => r.x !== frozen[i].x || r.y !== frozen[i].y),
    ).toBe(true);
  });

  it("fires no player or NPC shot while paused (no new tracers, no damage)", () => {
    const { module, hud, ship, enemy, setPaused } = makePausableFight();
    setPaused(true);
    for (let i = 0; i < 5; i++) module.update(FIRE);

    expect(hud.tracerStates.length).toBe(0); // no shot ever spawned a tracer
    expect(ship.hullHP).toBe(100); // NPC never fired → player hull untouched
    expect(enemy.npc.hullHP).toBe(100); // player never fired → enemy hull untouched
  });

  it("resumes player + NPC fire on cadence once unpaused", () => {
    const { module, hud, ship, enemy, setPaused } = makePausableFight();

    setPaused(true);
    module.update(FIRE);
    module.update(FIRE);
    expect(enemy.npc.hullHP).toBe(100);
    expect(ship.hullHP).toBe(100);

    setPaused(false);
    module.update(FIRE);
    expect(enemy.npc.hullHP).toBeLessThan(100); // player shot landed
    expect(ship.hullHP).toBeLessThan(100); // NPC shot landed
    expect(hud.tracerStates.length).toBeGreaterThan(0);
  });
});
