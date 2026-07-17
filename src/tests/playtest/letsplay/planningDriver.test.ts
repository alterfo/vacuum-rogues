/**
 * Task 15 (`20260713-tactical-pause-combat-rework`): unit coverage for the
 * headless pause-and-plan driver — the assign-and-confirm the letsplay agent
 * runs whenever the tactical PLANNING freeze is open. Pure stub tier (no
 * engine, no PixiJS): the seam is structural, so a plain object stands in for
 * the live `SpaceFlightScene`.
 */
import { describe, it, expect, vi } from "vitest";
import { confirmPlanningIfOpen } from "./planningDriver";

interface StubCombatant {
  npc: { id: string };
  x: number;
  y: number;
}

function makeScene(opts?: {
  isPlanning?: boolean;
  combatants?: StubCombatant[];
  selectedTarget?: StubCombatant | null;
  weapons?: unknown[];
  ship?: { shipX: number; shipY: number };
}) {
  const assignWeapon = vi.fn();
  const setDestination = vi.fn();
  const confirm = vi.fn(() => true);
  const scene = {
    combatPlanning: {
      isPlanning: opts?.isPlanning ?? true,
      assignWeapon,
      setDestination,
      confirm,
    },
    combatModule: {
      fittedWeapons: () => opts?.weapons ?? [{ id: "w1" }, { id: "w2" }],
      combatants: new Set(opts?.combatants ?? []),
      selectedTarget: opts?.selectedTarget ?? null,
    },
    shipPhysics: opts?.ship ?? { shipX: 0, shipY: 0 },
  };
  return { scene, assignWeapon, setDestination, confirm };
}

const foe = (id: string, x = 100, y = 0): StubCombatant => ({
  npc: { id },
  x,
  y,
});

describe("confirmPlanningIfOpen — headless assign-and-confirm (Task 15)", () => {
  it("is a safe no-op outside PLANNING and on partial stubs", () => {
    const { scene, confirm } = makeScene({ isPlanning: false });
    expect(confirmPlanningIfOpen(scene)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(confirmPlanningIfOpen(null)).toBe(false);
    expect(confirmPlanningIfOpen({})).toBe(false);
    expect(confirmPlanningIfOpen({ combatPlanning: null })).toBe(false);
  });

  it("assigns every fitted weapon to the preferred target and confirms", () => {
    const a = foe("npc_a", 500);
    const b = foe("npc_b", 50);
    const { scene, assignWeapon, confirm } = makeScene({
      combatants: [a, b],
    });
    expect(confirmPlanningIfOpen(scene, { preferredTargetId: "npc_a" })).toBe(
      true,
    );
    expect(assignWeapon).toHaveBeenCalledTimes(2);
    expect(assignWeapon.mock.calls.every((c) => c[1] === a)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("falls back preferred → live selection → nearest combatant", () => {
    const near = foe("npc_near", 10);
    const far = foe("npc_far", 900);
    // Unknown preferred id + no selection ⇒ nearest to the ship wins.
    const { scene, assignWeapon } = makeScene({ combatants: [far, near] });
    confirmPlanningIfOpen(scene, { preferredTargetId: "npc_gone" });
    expect(assignWeapon.mock.calls[0][1]).toBe(near);

    // A live selection that is still a combatant wins over nearest.
    const sel = makeScene({ combatants: [far, near], selectedTarget: far });
    confirmPlanningIfOpen(sel.scene);
    expect(sel.assignWeapon.mock.calls[0][1]).toBe(far);
  });

  it("confirms an empty-weapons draft when assignWeapons is false (flee)", () => {
    const { scene, assignWeapon, setDestination, confirm } = makeScene({
      combatants: [foe("npc_a")],
    });
    expect(confirmPlanningIfOpen(scene, { assignWeapons: false })).toBe(true);
    expect(assignWeapon).not.toHaveBeenCalled();
    expect(setDestination).not.toHaveBeenCalled(); // course untouched
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("steers at the target only when closeOnTarget is set", () => {
    const a = foe("npc_a", 300, 400);
    const hold = makeScene({ combatants: [a] });
    confirmPlanningIfOpen(hold.scene);
    expect(hold.setDestination).not.toHaveBeenCalled();

    const close = makeScene({ combatants: [a] });
    confirmPlanningIfOpen(close.scene, { closeOnTarget: true });
    expect(close.setDestination).toHaveBeenCalledWith({ x: 300, y: 400 });
  });

  it("confirms even with no combatants at all (empty draft = hold, resume)", () => {
    const { scene, assignWeapon, confirm } = makeScene({ combatants: [] });
    expect(confirmPlanningIfOpen(scene)).toBe(true);
    expect(assignWeapon).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
