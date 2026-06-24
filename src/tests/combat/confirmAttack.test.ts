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
 * Task 3 — the active-pause overlay's "confirm" path on the combat module.
 *
 * The overlay itself is PixiJS (covered by the regression spec + screenshot);
 * here we prove the pure module seam it routes through: {@link CombatModule.fittedWeapons}
 * lists the selectable weapons, and {@link CombatModule.confirmAttack} fires
 * exactly one shot with the player-chosen weapon, keeps that target selected,
 * and resets the auto-fire cadence — wired to a real {@link CombatPauseController}
 * the same way `SpaceFlightScene` does. No render context.
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE = gearById("wpn_pulse") as WeaponSpec; // dmg 14, range 240
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

function makeSprite(id: string, x: number, y: number): NpcShipSprite {
  return {
    x,
    y,
    npc: { id, name: id, hullHP: 100, maxHull: 100, damage: 20 },
  } as unknown as NpcShipSprite;
}

function makeFight(): {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  ship: { hullHP: number; maxHull: number };
  enemy: NpcShipSprite;
  loadout: ShipLoadout;
} {
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
  };
  const module = new CombatModule(deps);
  const enemy = makeSprite("a", 50, 0); // in range of both weapons
  module.addCombatant(enemy);
  return { module, controller, ship, enemy, loadout };
}

describe("CombatModule.fittedWeapons (Task 3)", () => {
  it("lists every weapon fitted in the loadout", () => {
    const { module } = makeFight();
    const ids = module.fittedWeapons().map((w) => w.id);
    expect(ids).toContain("wpn_pulse");
    expect(ids).toContain("wpn_beam");
  });

  it("is empty without a loadout", () => {
    const module = new CombatModule({ getShipPhysics: () => makePhysics() });
    expect(module.fittedWeapons()).toEqual([]);
  });
});

describe("CombatModule.confirmAttack (Task 3)", () => {
  it("fires exactly one shot with the chosen weapon and selects that target", () => {
    const { module, enemy } = makeFight();
    module.confirmAttack(enemy, BEAM);
    expect(enemy.npc.hullHP).toBe(100 - BEAM.damage); // beam, not the auto pulse
    expect(module.selectedTarget).toBe(enemy);
  });

  it("is a no-op against a ship that is not an engaged combatant", () => {
    const { module } = makeFight();
    const stranger = makeSprite("z", 999, 0);
    module.confirmAttack(stranger, PULSE);
    expect(stranger.npc.hullHP).toBe(100); // untouched — never engaged
  });

  it("lands a deliberate shot on an engaged target beyond weapon range (unlike auto-fire)", () => {
    // The headline rule of confirmAttack: a hand-picked shot is NOT range-gated,
    // while the real-time auto-fire is. Park an engaged enemy beyond pulse range
    // (240) but inside combatEscapeRange (1200) so it stays a combatant.
    const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>({
      onConfirm: (a) => module.confirmAttack(a.target, a.weapon),
    });
    const ship = { hullHP: 100, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      isTurnRunning: () => !controller.paused,
    };
    const module = new CombatModule(deps);
    const farEnemy = makeSprite("far", 500, 0); // > PULSE.range, < combatEscapeRange
    module.addCombatant(farEnemy);

    // Auto-fire is range-gated: a full interval lands nothing on the far enemy.
    module.update(FIRE);
    expect(farEnemy.npc.hullHP).toBe(100);

    // A deliberate confirmed shot lands anyway.
    module.confirmAttack(farEnemy, PULSE);
    expect(farEnemy.npc.hullHP).toBe(100 - PULSE.damage);
  });

  it("resets the fire cadence so the resumed auto-fire waits a full interval", () => {
    const { module, enemy } = makeFight();
    module.confirmAttack(enemy, PULSE); // one manual shot
    const afterConfirm = enemy.npc.hullHP;
    // A short tick (less than a full interval) must NOT fire again.
    module.update(FIRE - 1);
    expect(enemy.npc.hullHP).toBe(afterConfirm);
    // A full interval elapses → the auto-fire lands its next shot.
    module.update(1);
    expect(enemy.npc.hullHP).toBeLessThan(afterConfirm);
  });

  it("resumed real-time auto-fire fires ALL fitted weapons (Task 1 multi-weapon)", () => {
    const { module, enemy } = makeFight();
    // The confirmed shot is a single deliberate weapon (the beam). The *resumed*
    // real-time loop is the multi-weapon path: it fires every fitted weapon at an
    // in-range target — both the pulse (dmg 14) and the beam (dmg 30) here — not a
    // single persisted "active" weapon.
    module.confirmAttack(enemy, BEAM); // one deliberate beam shot
    const afterConfirm = enemy.npc.hullHP; // 100 - 30
    module.update(FIRE); // a resumed interval — every fitted weapon fires
    expect(enemy.npc.hullHP).toBe(afterConfirm - PULSE.damage - BEAM.damage);
  });

  it("resumed auto-fire fires only the still-fitted weapons after one is unequipped mid-fight", () => {
    // A weapon unequipped mid-fight leaves the resumed real-time loop — never
    // firing a weapon the loadout no longer carries. With the beam removed only
    // the pulse remains fitted, so only the pulse lands.
    const { module, enemy, loadout } = makeFight();
    module.confirmAttack(enemy, BEAM); // one deliberate beam shot
    const afterConfirm = enemy.npc.hullHP; // 100 - 30
    expect(loadout.remove("wpn_beam")).toBe(true); // beam unequipped mid-fight
    module.update(FIRE); // a resumed interval — only the still-fitted pulse fires
    expect(enemy.npc.hullHP).toBe(afterConfirm - PULSE.damage);
  });
});

describe("active-pause confirm wiring (Task 3)", () => {
  it("an attack pauses; confirming the controller fires one shot and resumes", () => {
    const { module, controller, enemy } = makeFight();

    // First interval: both sides fire and the incoming shot pauses the fight.
    module.update(FIRE);
    expect(controller.paused).toBe(true);
    const enemyHullAfterPause = enemy.npc.hullHP;

    // Player picks the beam and confirms — fires exactly one beam shot + resumes.
    controller.selectTarget(enemy);
    controller.selectWeapon(BEAM);
    const action = controller.confirm();

    expect(action).not.toBeNull();
    expect(controller.paused).toBe(false); // resumed
    expect(enemy.npc.hullHP).toBe(enemyHullAfterPause - BEAM.damage);
  });

  it("explicit resume without selecting does not fire", () => {
    const { controller, module, enemy } = makeFight();
    module.update(FIRE); // pauses
    const enemyHull = enemy.npc.hullHP;
    controller.resume();
    expect(controller.paused).toBe(false);
    expect(enemy.npc.hullHP).toBe(enemyHull); // nothing fired on resume
  });
});
