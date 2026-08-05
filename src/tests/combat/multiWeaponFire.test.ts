import { describe, it, expect } from "vitest";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { gearById, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const SCATTER = gearById("wpn_scatter") as WeaponSpec; // dmg 22, range 180
const RAILGUN = gearById("wpn_railgun") as WeaponSpec; // dmg 26, range 360
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

function makeModule(weaponIds: string[]): {
  module: CombatModule;
  loadout: ShipLoadout;
} {
  const loadout = new ShipLoadout("hull_warden"); // 3 weapon slots
  for (const id of weaponIds) loadout.install(id);
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
  };
  return { module: new CombatModule(deps), loadout };
}

describe("multi-weapon auto-fire (Task 1)", () => {
  it("each fitted weapon fires at a target inside its OWN range", () => {
    const { module } = makeModule(["wpn_scatter", "wpn_railgun"]);
    const near = makeSprite("near", 150, 0); // inside scatter (180) and railgun (360)
    const far = makeSprite("far", 300, 0); // outside scatter (180), inside railgun (360)
    module.addCombatant(near);
    module.addCombatant(far);
    module.selectTarget(far); // selected target is OUT of scatter's range

    module.update(2 * FIRE); // scatter (cooldownTurns 2) is the slowest fitted weapon

    expect(far.npc.hullHP).toBe(100 - RAILGUN.damage);
    expect(near.npc.hullHP).toBe(100 - SCATTER.damage);
  });

  it("a weapon with no combatant in range holds fire, then fires once one closes", () => {
    const { module } = makeModule(["wpn_scatter"]); // range 180
    const enemy = makeSprite("a", 250, 0); // beyond scatter's 180, still a combatant
    module.addCombatant(enemy);

    module.update(2 * FIRE); // scatter cooldownTurns 2 → its interval; primed but out of range
    expect(enemy.npc.hullHP).toBe(100); // held — nothing in range

    enemy.x = 150;
    module.update(1);
    expect(enemy.npc.hullHP).toBe(100 - SCATTER.damage);
  });

  it("total damage on a single in-range target reflects ALL fitted weapons", () => {
    const { module } = makeModule(["wpn_pulse", "wpn_beam"]);
    const enemy = makeSprite("a", 100, 0); // inside both ranges (240 / 300)
    module.addCombatant(enemy);

    module.update(3 * FIRE); // beam (cooldownTurns 3) is the slowest; both fire once

    expect(enemy.npc.hullHP).toBe(100 - PULSE.damage - BEAM.damage);
  });

  it("fires only the in-range weapons when targets sit at mixed distances", () => {
    const { module } = makeModule(["wpn_pulse", "wpn_beam"]);
    const enemy = makeSprite("a", 280, 0); // outside pulse (240), inside beam (300)
    module.addCombatant(enemy);

    module.update(3 * FIRE); // beam (cooldownTurns 3) is the slowest fitted weapon

    expect(enemy.npc.hullHP).toBe(100 - BEAM.damage); // beam only, pulse held
  });
});
