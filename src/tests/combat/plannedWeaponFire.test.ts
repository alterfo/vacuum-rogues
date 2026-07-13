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

/**
 * Task 6 — planned per-weapon target assignment replaces auto-fire.
 *
 * While the tactical planning loop's execute window is the active targeting
 * authority (`isPlannedTargetingActive`), each fitted weapon fires **only** at its
 * own confirmed assignment from `getPlannedWeaponTarget`, on its own
 * `weaponFireIntervalMs` cadence — *not* at the nearest-in-range pick. Recorded
 * decisions this suite pins:
 * - an **unassigned** weapon **holds fire** (the "empty draft = hold fire" rule,
 *   plan Task 1b) — NOT an auto-pick-nearest fallback;
 * - the execute-phase **range check is the sole authority** on a landing shot
 *   (plan Task 5's flag-don't-reject): an out-of-range or killed/fled assigned
 *   target simply holds until it becomes valid, exactly like the legacy loop's
 *   "primed but out of range" hold;
 * - when planned targeting is **inactive** (production today, and legacy DI sites),
 *   the module keeps the old `pickTargetInRange` auto-fire — so this change is
 *   inert until the combat-open trigger lands.
 *
 * Both `wpn_pulse` and `wpn_railgun` are `cooldownTurns: 1`, so a single
 * `update(FIRE)` tick makes every fitted weapon ready exactly once. Pure — no
 * PixiJS render context, and no `getPlayerShip`, so NPC return fire is a no-op and
 * nothing pauses the fight (the player's planned fire is isolated).
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE = gearById("wpn_pulse") as WeaponSpec; // dmg 14, range 240, cd 1
const RAILGUN = gearById("wpn_railgun") as WeaponSpec; // dmg 26, range 360, cd 1

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

interface Harness {
  module: CombatModule;
  assignments: Map<WeaponSpec, NpcShipSprite>;
  state: { plannedActive: boolean };
  weaponById(id: string): WeaponSpec;
}

function makeModule(weaponIds: string[]): Harness {
  const loadout = new ShipLoadout("hull_warden"); // 3 weapon slots
  for (const id of weaponIds) loadout.install(id);
  const assignments = new Map<WeaponSpec, NpcShipSprite>();
  const state = { plannedActive: true };
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    // The tactical planning loop drives targeting (Task 6). Toggle `plannedActive`
    // to false to fall back to the legacy auto-fire path.
    isPlannedTargetingActive: () => state.plannedActive,
    getPlannedWeaponTarget: (w) => assignments.get(w) ?? null,
  };
  const module = new CombatModule(deps);
  const weaponById = (id: string): WeaponSpec => {
    const w = module.fittedWeapons().find((x) => x.id === id);
    if (!w) throw new Error(`weapon ${id} not fitted`);
    return w;
  };
  return { module, assignments, state, weaponById };
}

describe("planned per-weapon fire (Task 6)", () => {
  it("each weapon fires at its OWN assigned target, not the nearest", () => {
    const h = makeModule(["wpn_pulse", "wpn_railgun"]);
    const near = makeSprite("near", 100, 0); // nearest to the ship at origin
    const far = makeSprite("far", 200, 0); // both in pulse (240) and railgun (360)
    h.module.addCombatant(near);
    h.module.addCombatant(far);
    // Deliberately assign the pulse to the FAR target and the railgun to the NEAR
    // one — the opposite of a nearest-pick, so a legacy auto-fire would be visible.
    h.assignments.set(h.weaponById("wpn_pulse"), far);
    h.assignments.set(h.weaponById("wpn_railgun"), near);

    h.module.update(FIRE);

    expect(far.npc.hullHP).toBe(100 - PULSE.damage); // pulse hit its far assignment
    expect(near.npc.hullHP).toBe(100 - RAILGUN.damage); // railgun hit its near one
  });

  it("focus-fire: every gun assigned to one target stacks all damage on it", () => {
    const h = makeModule(["wpn_pulse", "wpn_railgun"]);
    const focus = makeSprite("focus", 120, 0);
    const other = makeSprite("other", 150, 0);
    h.module.addCombatant(focus);
    h.module.addCombatant(other);
    h.assignments.set(h.weaponById("wpn_pulse"), focus);
    h.assignments.set(h.weaponById("wpn_railgun"), focus);

    h.module.update(FIRE);

    expect(focus.npc.hullHP).toBe(100 - PULSE.damage - RAILGUN.damage);
    expect(other.npc.hullHP).toBe(100); // no gun aimed at it
  });

  it("spread-fire: guns on different targets each resolve independently", () => {
    const h = makeModule(["wpn_pulse", "wpn_railgun"]);
    const a = makeSprite("a", 100, 0);
    const b = makeSprite("b", 130, 0);
    h.module.addCombatant(a);
    h.module.addCombatant(b);
    h.assignments.set(h.weaponById("wpn_pulse"), a);
    h.assignments.set(h.weaponById("wpn_railgun"), b);

    h.module.update(FIRE);

    expect(a.npc.hullHP).toBe(100 - PULSE.damage);
    expect(b.npc.hullHP).toBe(100 - RAILGUN.damage);
  });

  it("an UNASSIGNED weapon holds fire even with a target in its range", () => {
    const h = makeModule(["wpn_pulse", "wpn_railgun"]);
    const a = makeSprite("a", 100, 0);
    const b = makeSprite("b", 150, 0); // in railgun range (360), but railgun unassigned
    h.module.addCombatant(a);
    h.module.addCombatant(b);
    // Only the pulse is assigned; the railgun is left unassigned → it holds fire.
    h.assignments.set(h.weaponById("wpn_pulse"), a);

    h.module.update(FIRE);

    expect(a.npc.hullHP).toBe(100 - PULSE.damage); // assigned pulse fired
    expect(b.npc.hullHP).toBe(100); // unassigned railgun held — not an auto-pick
  });

  it("an out-of-range assigned target holds fire, then fires once it closes", () => {
    const h = makeModule(["wpn_pulse"]); // range 240
    const target = makeSprite("t", 300, 0); // beyond pulse range, assigned anyway
    h.module.addCombatant(target);
    h.assignments.set(h.weaponById("wpn_pulse"), target);

    h.module.update(FIRE); // assigned but out of range → primed, holds
    expect(target.npc.hullHP).toBe(100);

    target.x = 100; // the planned course carried it into range this round
    h.module.update(1);
    expect(target.npc.hullHP).toBe(100 - PULSE.damage);
  });

  it("a killed/fled assigned target (no longer a combatant) holds fire", () => {
    const h = makeModule(["wpn_pulse"]);
    // `gone` was assigned during planning but is not (or is no longer) a live
    // combatant — the same `combatants.has()` gate a killed/fled ship falls
    // through. `bystander` IS a live combatant in range but unassigned.
    const gone = makeSprite("gone", 100, 0);
    const bystander = makeSprite("bystander", 110, 0);
    h.module.addCombatant(bystander);
    h.assignments.set(h.weaponById("wpn_pulse"), gone);

    h.module.update(FIRE);

    // The assigned target isn't a live combatant → hold fire; the unassigned
    // bystander is NOT adopted as a fallback (that would be nearest-pick
    // auto-fire, not planned targeting).
    expect(gone.npc.hullHP).toBe(100);
    expect(bystander.npc.hullHP).toBe(100);
  });

  it("legacy auto-fire resumes when planned targeting is inactive", () => {
    const h = makeModule(["wpn_pulse", "wpn_railgun"]);
    const a = makeSprite("a", 100, 0); // nearest — legacy loop picks it
    h.module.addCombatant(a);
    // No assignments; planned targeting OFF → the module uses pickTargetInRange.
    h.state.plannedActive = false;

    h.module.update(FIRE);

    // Both guns auto-fire at the nearest in-range combatant (the legacy path),
    // proving the new planned path is gated and inert until the trigger lands.
    expect(a.npc.hullHP).toBe(100 - PULSE.damage - RAILGUN.damage);
  });
});
