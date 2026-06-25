import { describe, it, expect } from "vitest";
import { CombatPauseController } from "@/presentation/flight/combatPause";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { gearById, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 4 — resume / disengage + preserve combat hooks.
 *
 * The active-pause confirm path reuses the same {@link CombatModule.firePlayerShot}
 * as the real-time loop, so a killing blow landed *during* active-pause must still
 * fire the `onNpcDestroyed` hook the scene wires to its BOUNTY / quest-completion
 * flow — exactly as a real-time kill does. And when a fight ends (kill / flee /
 * disengage) the module fires `onCombatEnded`, which the scene wires to
 * {@link CombatPauseController.reset} so the incoming-attack debounce re-arms and
 * the *next* engagement pauses on its first shot. Pure — no PixiJS render context.
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const BEAM = gearById("wpn_beam") as WeaponSpec; // dmg 30, range 300

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
  hullHP = 100,
  damage = 20,
): NpcShipSprite {
  return {
    x,
    y,
    npc: { id, name: id, hullHP, maxHull: 100, damage },
  } as unknown as NpcShipSprite;
}

/**
 * A module wired to a pause controller the same way `SpaceFlightScene` does, plus
 * spies on the two hooks Task 4 protects: `onNpcDestroyed` (the bounty seam) and
 * `onCombatEnded` (the debounce-rearm seam, wired to `controller.reset`).
 */
function makeFight(opts: { enemyHp?: number } = {}): {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  enemy: NpcShipSprite;
  destroyed: NpcShipSprite[];
  combatEnded: () => number;
  loadout: ShipLoadout;
} {
  const destroyed: NpcShipSprite[] = [];
  let endedCount = 0;
  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>({
    onConfirm: (a) => module.confirmAttack(a.target, a.weapon),
  });
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  loadout.install("wpn_beam");
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    isTurnRunning: () => !controller.paused,
    onPlayerUnderAttack: () => {
      controller.requestPause("incoming-attack");
    },
    onNpcDestroyed: (s) => {
      destroyed.push(s);
    },
    onCombatEnded: () => {
      endedCount += 1;
      controller.reset();
    },
  };
  const module = new CombatModule(deps);
  const enemy = makeSprite("a", 50, 0, opts.enemyHp ?? 100); // in range of both weapons
  module.addCombatant(enemy);
  return {
    module,
    controller,
    enemy,
    destroyed,
    combatEnded: () => endedCount,
    loadout,
  };
}

describe("active-pause preserves the kill hook (Task 4)", () => {
  it("a kill confirmed during active-pause still fires onNpcDestroyed (bounty seam)", () => {
    // Enemy low enough that one confirmed beam shot is lethal — but high enough to
    // survive the multi-weapon auto-fire (pulse 14 + beam 30 = 44) so the fight
    // reaches the pause. The confirmed beam (30) then finishes the 16 HP left.
    const { module, controller, enemy, destroyed } = makeFight({ enemyHp: 60 });

    // A tick long enough for the slowest fitted weapon (beam, cooldownTurns 3) so
    // both player weapons land (pulse 14 + beam 30 = 44); the NPC's return shot
    // (fired after, on the base interval) then pauses the fight.
    module.update(3 * FIRE);
    expect(controller.paused).toBe(true);
    expect(enemy.npc.hullHP).toBeGreaterThan(0); // auto-fire only softened it

    controller.selectTarget(enemy);
    controller.selectWeapon(BEAM);
    const action = controller.confirm();

    expect(action).not.toBeNull();
    expect(enemy.npc.hullHP).toBe(0); // killed by the confirmed beam
    expect(destroyed).toEqual([enemy]); // bounty/quest hook fired exactly once
    expect(controller.paused).toBe(false); // time resumed after the confirmed action
  });
});

describe("disengage re-arms the active-pause debounce (Task 4)", () => {
  it("after a fight ends, the next engagement pauses again on its first incoming shot", () => {
    const { module, controller, enemy, combatEnded } = makeFight({
      enemyHp: 60, // survives the multi-weapon auto-fire so the fight pauses first
    });

    // Kill the only combatant during active-pause, then resume. The first tick is
    // long enough for the slowest fitted weapon (beam, cooldownTurns 3) so the
    // multi-weapon auto-fire lands its 44 (pulse 14 + beam 30) and the fight pauses.
    module.update(3 * FIRE);
    controller.selectTarget(enemy);
    controller.selectWeapon(BEAM);
    controller.confirm();
    expect(controller.paused).toBe(false);

    // A frame with the set emptied ends the fight → onCombatEnded → reset().
    module.update(1);
    expect(module.isActive).toBe(false);
    expect(combatEnded()).toBe(1);

    // A fresh aggressor opens fire — the debounce was re-armed, so it re-pauses
    // (without the reset the consumed "incoming-attack" trigger would never fire).
    const enemy2 = makeSprite("b", 50, 0, 100);
    module.addCombatant(enemy2);
    module.update(FIRE);
    expect(controller.paused).toBe(true);
  });
});
