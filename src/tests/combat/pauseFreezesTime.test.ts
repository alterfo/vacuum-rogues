import { describe, it, expect } from "vitest";
import { CombatPauseController } from "@/presentation/flight/combatPause";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms
const PULSE_DMG = 14; // wpn_pulse damage (range 240) — see combatModule.test.ts

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

function makeWiredFight(): {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  ship: { hullHP: number; maxHull: number };
  enemy: NpcShipSprite;
} {
  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>();
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    isTurnRunning: () => !controller.paused,
    onPlayerUnderAttack: () => {
      controller.requestPause("incoming-attack");
    },
  };
  const module = new CombatModule(deps);
  const enemy = makeSprite("a", 50, 0, 20); // in pulse range (240) and NPC weaponRange
  module.addCombatant(enemy); // auto-selects `enemy` as the player's target
  return { module, controller, ship, enemy };
}

describe("active-pause freezes simulation time (Task 2)", () => {
  it("an incoming shot pauses the fight on the same frame both sides first fire", () => {
    const { module, controller, ship, enemy } = makeWiredFight();

    expect(controller.paused).toBe(false);
    expect(ship.hullHP).toBe(100);
    expect(enemy.npc.hullHP).toBe(100);

    module.update(FIRE);

    expect(ship.hullHP).toBe(80); // 100 - 20 NPC damage
    expect(enemy.npc.hullHP).toBe(100 - PULSE_DMG); // player's return fire landed
    expect(controller.paused).toBe(true); // froze on the first incoming shot
    expect(module.isActive).toBe(true); // the fight is still on, just paused
  });

  it("while paused, further frames advance no sim state (fire timers frozen)", () => {
    const { module, controller, ship, enemy } = makeWiredFight();
    module.update(FIRE); // pauses
    const hullAfterPause = ship.hullHP;
    const enemyHullAfterPause = enemy.npc.hullHP;
    expect(controller.paused).toBe(true);

    module.update(FIRE);
    module.update(FIRE);
    module.update(FIRE * 3);

    expect(ship.hullHP).toBe(hullAfterPause); // player hull frozen
    expect(enemy.npc.hullHP).toBe(enemyHullAfterPause); // enemy hull frozen
    expect(controller.paused).toBe(true);
  });

  it("resuming lets the fight advance again (fire timers tick once more)", () => {
    const { module, controller, ship, enemy } = makeWiredFight();
    module.update(FIRE); // pauses after the first exchange
    const hullAfterPause = ship.hullHP;
    const enemyHullAfterPause = enemy.npc.hullHP;

    controller.resume();
    expect(controller.paused).toBe(false);

    module.update(FIRE); // a full interval — both sides fire again
    expect(ship.hullHP).toBe(hullAfterPause - 20); // NPC fired again
    expect(enemy.npc.hullHP).toBe(enemyHullAfterPause - PULSE_DMG); // player fired again
    expect(controller.paused).toBe(false); // debounce keeps the fight live
  });

  it("the module's isTurnRunning gate reports frozen exactly while paused", () => {
    const { module, controller } = makeWiredFight();
    expect(controller.paused).toBe(false);
    module.update(FIRE);
    expect(controller.paused).toBe(true); // gate now reports frozen
    controller.resume();
    expect(controller.paused).toBe(false); // gate reports running again
  });

  it("with several aligned aggressors, only one shot lands on the pausing frame", () => {
    const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>();
    const ship = { hullHP: 100, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      isTurnRunning: () => !controller.paused,
      onPlayerUnderAttack: () => {
        controller.requestPause("incoming-attack");
      },
    };
    const module = new CombatModule(deps);
    module.addCombatant(makeSprite("a", 50, 0, 20));
    module.addCombatant(makeSprite("b", 60, 0, 20));
    module.addCombatant(makeSprite("c", 70, 0, 20));

    module.update(FIRE);

    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBe(80); // exactly one 20-damage NPC shot, not 40 or 20
  });
});
