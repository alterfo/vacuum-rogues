import { describe, it, expect } from "vitest";
import {
  WEAPON_RANGE_PALETTE,
  weaponRangeColor,
  weaponRangeCircles,
  targetInRange,
  WeaponAssignmentController,
  type RangedWeapon,
} from "@/presentation/flight/combatWeaponTargeting";
import { CombatPlanningController } from "@/presentation/flight/combatPlanning";

// Opaque target handle; a weapon carries the range the assignment flag reads.
type Target = { id: string };

function weapon(id: string, range: number): RangedWeapon {
  return { id, range };
}

// ---------------------------------------------------------------------------
// Range-circle geometry + colour (Task 5)
// ---------------------------------------------------------------------------
describe("weaponRangeCircles — per-weapon range visualization (Task 5)", () => {
  it("radius matches each weapon's own catalog range, centred on the ship", () => {
    const circles = weaponRangeCircles(
      [weapon("wpn_pulse", 240), weapon("wpn_railgun", 360)],
      { x: 50, y: -20 },
    );
    expect(circles).toHaveLength(2);
    expect(circles[0]).toMatchObject({
      weaponId: "wpn_pulse",
      radius: 240,
      x: 50,
      y: -20,
    });
    expect(circles[1]).toMatchObject({
      weaponId: "wpn_railgun",
      radius: 360,
      x: 50,
      y: -20,
    });
  });

  it("gives each weapon a distinct colour by slot order (stable, wraps past the palette)", () => {
    const circles = weaponRangeCircles(
      Array.from({ length: WEAPON_RANGE_PALETTE.length + 1 }, (_, i) =>
        weapon(`w${i}`, 100),
      ),
      { x: 0, y: 0 },
    );
    // First N are the palette in order.
    for (let i = 0; i < WEAPON_RANGE_PALETTE.length; i++) {
      expect(circles[i].color).toBe(WEAPON_RANGE_PALETTE[i]);
    }
    // The (N+1)-th wraps back to the first palette entry.
    expect(circles[WEAPON_RANGE_PALETTE.length].color).toBe(
      WEAPON_RANGE_PALETTE[0],
    );
    // Adjacent weapons never share a colour (within one palette cycle).
    for (let i = 1; i < WEAPON_RANGE_PALETTE.length; i++) {
      expect(circles[i].color).not.toBe(circles[i - 1].color);
    }
  });

  it("weaponRangeColor wraps for negative indices too", () => {
    const n = WEAPON_RANGE_PALETTE.length;
    expect(weaponRangeColor(0)).toBe(WEAPON_RANGE_PALETTE[0]);
    expect(weaponRangeColor(n)).toBe(WEAPON_RANGE_PALETTE[0]);
    expect(weaponRangeColor(-1)).toBe(WEAPON_RANGE_PALETTE[n - 1]);
  });

  it("clamps a zero/negative-range weapon to a radius-0 circle (drawn as nothing)", () => {
    const circles = weaponRangeCircles([weapon("broken", -5)], { x: 0, y: 0 });
    expect(circles[0].radius).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Range test (Task 5)
// ---------------------------------------------------------------------------
describe("targetInRange (Task 5)", () => {
  it("is inclusive at the boundary and false beyond it", () => {
    const from = { x: 0, y: 0 };
    expect(targetInRange(100, from, { x: 100, y: 0 })).toBe(true); // exactly on the ring
    expect(targetInRange(100, from, { x: 60, y: 80 })).toBe(true); // dist 100
    expect(targetInRange(100, from, { x: 101, y: 0 })).toBe(false);
    expect(targetInRange(100, from, { x: 71, y: 71 })).toBe(false); // dist ~100.4
  });

  it("a non-positive range is never in range", () => {
    expect(targetInRange(0, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(targetInRange(-10, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two-step assignment interaction — writes into the planned-turn draft (Task 5)
// ---------------------------------------------------------------------------
describe("WeaponAssignmentController — click-weapon-then-click-target (Task 5)", () => {
  function setup() {
    // Real planning controller as the sink so we assert the ACTUAL draft, not a fake.
    const planning = new CombatPlanningController<Target, RangedWeapon>();
    planning.beginCombat(); // enter PLANNING so draft setters are live
    const ctrl = new WeaponAssignmentController<RangedWeapon, Target>(planning);
    return { planning, ctrl };
  }

  it("assignment persists into the planned-turn draft; in-range flag set", () => {
    const { planning, ctrl } = setup();
    const w = weapon("wpn_pulse", 240);
    const enemy: Target = { id: "e1" };

    expect(ctrl.selectWeapon(w)).toBe(w); // armed
    expect(ctrl.selectedWeapon).toBe(w);

    const res = ctrl.selectTarget(enemy, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(res).toEqual({ weapon: w, target: enemy, inRange: true });
    expect(planning.plan.weaponTargets.get(w)).toBe(enemy);
    expect(ctrl.selectedWeapon).toBeNull(); // selection cleared after assign
  });

  it("re-assignment overwrites cleanly (focus fire → new target)", () => {
    const { planning, ctrl } = setup();
    const w = weapon("wpn_pulse", 240);
    const e1: Target = { id: "e1" };
    const e2: Target = { id: "e2" };

    ctrl.selectWeapon(w);
    ctrl.selectTarget(e1, { x: 0, y: 0 }, { x: 10, y: 0 });
    ctrl.selectWeapon(w);
    ctrl.selectTarget(e2, { x: 0, y: 0 }, { x: 20, y: 0 });

    expect(planning.plan.weaponTargets.size).toBe(1);
    expect(planning.plan.weaponTargets.get(w)).toBe(e2);
  });

  it("focus-fire: two weapons both target one enemy; spread: two weapons, two enemies", () => {
    const { planning, ctrl } = setup();
    const w1 = weapon("a", 300);
    const w2 = weapon("b", 300);
    const e1: Target = { id: "e1" };
    const e2: Target = { id: "e2" };

    // Focus fire — both guns on e1.
    ctrl.selectWeapon(w1);
    ctrl.selectTarget(e1, { x: 0, y: 0 }, { x: 10, y: 0 });
    ctrl.selectWeapon(w2);
    ctrl.selectTarget(e1, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(planning.plan.weaponTargets.get(w1)).toBe(e1);
    expect(planning.plan.weaponTargets.get(w2)).toBe(e1);

    // Spread — re-aim w2 at e2.
    ctrl.selectWeapon(w2);
    ctrl.selectTarget(e2, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(planning.plan.weaponTargets.get(w1)).toBe(e1);
    expect(planning.plan.weaponTargets.get(w2)).toBe(e2);
  });

  it("an out-of-range assignment is FLAGGED, not rejected (recorded decision)", () => {
    const { planning, ctrl } = setup();
    const w = weapon("wpn_pulse", 100);
    const far: Target = { id: "far" };

    ctrl.selectWeapon(w);
    const res = ctrl.selectTarget(far, { x: 0, y: 0 }, { x: 500, y: 0 });
    expect(res?.inRange).toBe(false); // flagged out of range
    // ...but still recorded (a planned lead-the-target shot is legal).
    expect(planning.plan.weaponTargets.get(w)).toBe(far);
  });

  it("selecting a target with no weapon armed is a no-op", () => {
    const { planning, ctrl } = setup();
    const res = ctrl.selectTarget({ id: "e" }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(res).toBeNull();
    expect(planning.plan.weaponTargets.size).toBe(0);
  });

  it("re-selecting the armed weapon toggles the selection off; clearSelection drops it", () => {
    const { ctrl } = setup();
    const w = weapon("a", 100);
    expect(ctrl.selectWeapon(w)).toBe(w);
    expect(ctrl.selectWeapon(w)).toBeNull(); // toggled off
    ctrl.selectWeapon(w);
    ctrl.clearSelection();
    expect(ctrl.selectedWeapon).toBeNull();
  });

  it("unassign clears the weapon from the draft and drops a matching pending selection", () => {
    const { planning, ctrl } = setup();
    const w = weapon("a", 100);
    ctrl.selectWeapon(w);
    ctrl.selectTarget({ id: "e" }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(planning.plan.weaponTargets.has(w)).toBe(true);

    ctrl.selectWeapon(w); // arm again
    ctrl.unassign(w);
    expect(planning.plan.weaponTargets.has(w)).toBe(false);
    expect(ctrl.selectedWeapon).toBeNull();
  });

  it("assignments made outside PLANNING never leak into the draft (sink no-ops)", () => {
    const planning = new CombatPlanningController<Target, RangedWeapon>();
    planning.beginCombat();
    planning.confirm(); // now EXECUTING — draft setters no-op
    const ctrl = new WeaponAssignmentController<RangedWeapon, Target>(planning);

    const w = weapon("a", 100);
    ctrl.selectWeapon(w);
    ctrl.selectTarget({ id: "e" }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(planning.plan.weaponTargets.size).toBe(0); // nothing written mid-execute
  });
});
