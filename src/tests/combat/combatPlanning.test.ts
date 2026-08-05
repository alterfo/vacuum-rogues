import { describe, it, expect, vi } from "vitest";
import {
  CombatPlanningController,
  DEFAULT_ROUND_MS,
  type PlannedTurn,
} from "@/presentation/flight/combatPlanning";
import { COMBAT_ROUND_MS } from "@/config/balance";

type Target = { id: string };
type Weapon = { id: string };

const ROUND = 4000; // explicit test window (distinct from the default so tickExecute math is unambiguous)

describe("CombatPlanningController phase transitions (Task 2)", () => {
  it("starts idle; beginCombat opens planning (freeze) with a fresh empty draft", () => {
    const onEnterPlanning = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({ onEnterPlanning });

    expect(c.phase).toBe("idle");
    expect(c.isPlanning).toBe(false);

    expect(c.beginCombat()).toBe(true);
    expect(c.phase).toBe("planning");
    expect(c.isPlanning).toBe(true);
    expect(onEnterPlanning).toHaveBeenCalledTimes(1);

    const p = c.plan;
    expect(p.destination).toBeNull();
    expect(p.weaponTargets.size).toBe(0);
    expect(p.afterburner).toBe(false);
    expect(p.consumableId).toBeNull();
    expect(p.commsAction).toBeNull();
  });

  it("beginCombat is a no-op once a fight is underway (never resets the draft mid-turn)", () => {
    const onEnterPlanning = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({ onEnterPlanning });

    c.beginCombat();
    c.setAfterburner(true);
    expect(c.beginCombat()).toBe(false); // still planning — no re-open
    expect(c.plan.afterburner).toBe(true); // draft survived
    expect(onEnterPlanning).toHaveBeenCalledTimes(1);

    c.confirm();
    expect(c.beginCombat()).toBe(false); // executing — no re-open
    expect(c.phase).toBe("executing");
  });

  it("confirm ends planning and starts the real-time execute window (handing over the draft)", () => {
    const onConfirm = vi.fn();
    const onEnterExecuting = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({
      onConfirm,
      onEnterExecuting,
      roundMs: ROUND,
    });

    c.beginCombat();
    const target: Target = { id: "t1" };
    const weapon: Weapon = { id: "w1" };
    c.setDestination({ x: 100, y: 50 });
    c.assignWeapon(weapon, target);

    expect(c.confirm()).toBe(true);
    expect(c.phase).toBe("executing");
    expect(c.isExecuting).toBe(true);
    expect(onEnterExecuting).toHaveBeenCalledTimes(1);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const handed = onConfirm.mock.calls[0][0] as PlannedTurn<Target, Weapon>;
    expect(handed.destination).toEqual({ x: 100, y: 50 });
    expect(handed.weaponTargets.get(weapon)).toBe(target);
  });

  it("the execute window ends only when the round timer elapses, then re-opens planning", () => {
    const onEnterPlanning = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({
      onEnterPlanning,
      roundMs: ROUND,
    });

    c.beginCombat(); // planning #1 → onEnterPlanning call 1
    c.confirm(); // executing

    expect(c.tickExecute(1000)).toBe(false);
    expect(c.tickExecute(1000)).toBe(false);
    expect(c.executeProgress()).toBeCloseTo(0.5, 5);
    expect(c.phase).toBe("executing");

    expect(c.tickExecute(2000)).toBe(true);
    expect(c.phase).toBe("planning");
    expect(onEnterPlanning).toHaveBeenCalledTimes(2);

    expect(c.plan.destination).toBeNull();
    expect(c.plan.weaponTargets.size).toBe(0);
  });

  it("idle → planning → executing → planning is a repeatable cycle", () => {
    const c = new CombatPlanningController<Target, Weapon>({ roundMs: ROUND });
    expect(c.phase).toBe("idle");

    c.beginCombat();
    expect(c.phase).toBe("planning");
    c.confirm();
    expect(c.phase).toBe("executing");
    expect(c.tickExecute(ROUND)).toBe(true);
    expect(c.phase).toBe("planning"); // next planning cycle

    c.confirm();
    expect(c.phase).toBe("executing");
    expect(c.tickExecute(ROUND)).toBe(true);
    expect(c.phase).toBe("planning"); // and again
  });
});

describe("CombatPlanningController malformed / incomplete plan confirms (Task 2)", () => {
  it("confirming an empty draft is legal (hold position, hold fire)", () => {
    const onConfirm = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({ onConfirm });

    c.beginCombat();
    expect(c.confirm()).toBe(true); // never blocked on an empty plan
    expect(c.phase).toBe("executing");
    const handed = onConfirm.mock.calls[0][0] as PlannedTurn<Target, Weapon>;
    expect(handed.destination).toBeNull();
    expect(handed.weaponTargets.size).toBe(0);
    expect(handed.afterburner).toBe(false);
  });

  it("confirm from idle is rejected (nothing to run)", () => {
    const onConfirm = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({ onConfirm });
    expect(c.confirm()).toBe(false);
    expect(c.phase).toBe("idle");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a double-confirm mid-execute is rejected (only one execute window per confirm)", () => {
    const onEnterExecuting = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({
      onEnterExecuting,
      roundMs: ROUND,
    });
    c.beginCombat();
    expect(c.confirm()).toBe(true);
    expect(c.confirm()).toBe(false); // already executing
    expect(onEnterExecuting).toHaveBeenCalledTimes(1);
  });

  it("draft mutations outside planning are ignored (the confirmed plan can't be edited mid-execute)", () => {
    const c = new CombatPlanningController<Target, Weapon>({ roundMs: ROUND });

    c.setAfterburner(true);
    expect(c.plan.afterburner).toBe(false);

    c.beginCombat();
    c.setDestination({ x: 1, y: 2 });
    c.confirm(); // executing — draft is now frozen

    c.setDestination({ x: 9, y: 9 });
    c.assignWeapon({ id: "w" }, { id: "t" });
    c.setAfterburner(true);
    expect(c.plan.destination).toEqual({ x: 1, y: 2 }); // unchanged since confirm
    expect(c.plan.weaponTargets.size).toBe(0);
    expect(c.plan.afterburner).toBe(false);
  });
});

describe("CombatPlanningController terminal fight-end (Task 2)", () => {
  it("a lethal hit mid-execute ends the whole fight; subsequent ticks are inert", () => {
    const onCombatEnd = vi.fn();
    const onEnterPlanning = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({
      onCombatEnd,
      onEnterPlanning,
      roundMs: ROUND,
    });

    c.beginCombat(); // planning #1
    c.confirm(); // executing
    c.tickExecute(1500); // mid-window

    expect(c.endCombat()).toBe(true);
    expect(c.phase).toBe("idle");
    expect(onCombatEnd).toHaveBeenCalledTimes(1);

    expect(c.tickExecute(ROUND)).toBe(false);
    expect(c.phase).toBe("idle");
    expect(onEnterPlanning).toHaveBeenCalledTimes(1); // only the opening planning
    expect(c.plan.destination).toBeNull();
  });

  it("endCombat from planning ends the fight too; endCombat when idle is a no-op", () => {
    const onCombatEnd = vi.fn();
    const c = new CombatPlanningController<Target, Weapon>({ onCombatEnd });

    c.beginCombat();
    expect(c.endCombat()).toBe(true); // planning → idle (last hostile gone before confirm)
    expect(c.phase).toBe("idle");

    expect(c.endCombat()).toBe(false); // already idle
    expect(onCombatEnd).toHaveBeenCalledTimes(1);
  });
});

describe("CombatPlanningController round timer config (Task 2)", () => {
  it("falls back to DEFAULT_ROUND_MS when no roundMs supplied", () => {
    const c = new CombatPlanningController<Target, Weapon>({});
    c.beginCombat();
    c.confirm();
    expect(c.tickExecute(DEFAULT_ROUND_MS - 1)).toBe(false);
    expect(c.tickExecute(1)).toBe(true);
  });

  it("DEFAULT_ROUND_MS mirrors the balance COMBAT_ROUND_MS the scene passes", () => {
    expect(DEFAULT_ROUND_MS).toBe(COMBAT_ROUND_MS);
  });

  it("a non-positive configured roundMs falls back to the default (never a zero-length window)", () => {
    const c = new CombatPlanningController<Target, Weapon>({ roundMs: 0 });
    c.beginCombat();
    c.confirm();
    expect(c.tickExecute(DEFAULT_ROUND_MS - 1)).toBe(false);
    expect(c.tickExecute(1)).toBe(true);
  });
});
