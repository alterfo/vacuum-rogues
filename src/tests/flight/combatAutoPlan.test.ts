import { describe, it, expect } from "vitest";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import {
  autoConfirmCombatTurn,
  combatRouteClickAllowed,
  nearestAutoTarget,
} from "@/presentation/flight/combatAutoPlan";

const weapon = (id: string): WeaponSpec => ({ id }) as unknown as WeaponSpec;

interface FakeTarget {
  id: string;
  x: number;
  y: number;
}

const target = (id: string, x: number, y: number): FakeTarget => ({ id, x, y });

describe("nearestAutoTarget", () => {
  it("picks the combatant closest to the ship", () => {
    const near = target("near", 10, 0);
    const far = target("far", 500, 500);
    expect(nearestAutoTarget({ x: 0, y: 0 }, [far, near])).toBe(near);
  });

  it("returns null with no combatants", () => {
    expect(nearestAutoTarget({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe("autoConfirmCombatTurn", () => {
  it("assigns every fitted weapon to the nearest combatant and confirms", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    planning.beginCombat();
    const w1 = weapon("w1");
    const w2 = weapon("w2");
    const near = target("near", 10, 0);
    const far = target("far", 900, 0);
    const plan = planning.plan;

    const confirmed = autoConfirmCombatTurn(planning, [w1, w2], [far, near], {
      x: 0,
      y: 0,
    });

    expect(confirmed).toBe(true);
    expect(planning.isExecuting).toBe(true);
    expect(plan.weaponTargets.get(w1)).toBe(near);
    expect(plan.weaponTargets.get(w2)).toBe(near);
  });

  it("is a no-op outside the planning phase", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    expect(
      autoConfirmCombatTurn(planning, [weapon("w1")], [], { x: 0, y: 0 }),
    ).toBe(false);
    expect(planning.phase).toBe("idle");
  });

  it("confirms an empty hold-fire plan when no combatant remains", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    planning.beginCombat();
    const plan = planning.plan;

    const confirmed = autoConfirmCombatTurn(planning, [weapon("w1")], [], {
      x: 0,
      y: 0,
    });

    expect(confirmed).toBe(true);
    expect(planning.isExecuting).toBe(true);
    expect(plan.weaponTargets.size).toBe(0);
  });

  it("keeps firing at the player's selected target even when another hostile is closer", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    planning.beginCombat();
    const w1 = weapon("w1");
    const near = target("near", 10, 0);
    const chosen = target("chosen", 600, 0);
    const plan = planning.plan;

    autoConfirmCombatTurn(
      planning,
      [w1],
      [near, chosen],
      { x: 0, y: 0 },
      chosen,
    );

    expect(plan.weaponTargets.get(w1)).toBe(chosen);
  });

  it("ignores a stale selection that is no longer a combatant", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    planning.beginCombat();
    const w1 = weapon("w1");
    const near = target("near", 10, 0);
    const gone = target("gone", 5, 5);
    const plan = planning.plan;

    autoConfirmCombatTurn(planning, [w1], [near], { x: 0, y: 0 }, gone);

    expect(plan.weaponTargets.get(w1)).toBe(near);
  });

  it("falls back to the first combatant when the ship position is unknown", () => {
    const planning = new CombatPlanningController<FakeTarget, WeaponSpec>();
    planning.beginCombat();
    const w1 = weapon("w1");
    const first = target("first", 900, 0);
    const plan = planning.plan;

    autoConfirmCombatTurn(planning, [w1], [first, target("b", 1, 1)], null);

    expect(plan.weaponTargets.get(w1)).toBe(first);
  });
});

describe("combatRouteClickAllowed", () => {
  it("lets route clicks through only during an auto-combat fight", () => {
    expect(
      combatRouteClickAllowed({ combatActive: true, autoCombat: true }),
    ).toBe(true);
    expect(
      combatRouteClickAllowed({ combatActive: true, autoCombat: false }),
    ).toBe(false);
    expect(
      combatRouteClickAllowed({ combatActive: false, autoCombat: true }),
    ).toBe(false);
  });
});
