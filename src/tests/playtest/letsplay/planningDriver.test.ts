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
  const setAfterburner = vi.fn();
  const setConsumable = vi.fn();
  const setComms = vi.fn();
  const scene = {
    combatPlanning: {
      isPlanning: opts?.isPlanning ?? true,
      assignWeapon,
      setDestination,
      setAfterburner,
      setConsumable,
      setComms,
      confirm,
    },
    combatModule: {
      fittedWeapons: () => opts?.weapons ?? [{ id: "w1" }, { id: "w2" }],
      combatants: new Set(opts?.combatants ?? []),
      selectedTarget: opts?.selectedTarget ?? null,
    },
    shipPhysics: opts?.ship ?? { shipX: 0, shipY: 0 },
  };
  return {
    scene,
    assignWeapon,
    setDestination,
    confirm,
    setAfterburner,
    setConsumable,
    setComms,
  };
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

  it("leaves afterburner/consumable/comms untouched when the options are omitted (existing callers unchanged)", () => {
    const { scene, setAfterburner, setConsumable, setComms } = makeScene({
      combatants: [foe("npc_a")],
    });
    confirmPlanningIfOpen(scene, { preferredTargetId: "npc_a" });
    expect(setAfterburner).not.toHaveBeenCalled();
    expect(setConsumable).not.toHaveBeenCalled();
    expect(setComms).not.toHaveBeenCalled();
  });

  it("sets afterburner/consumable/comms when passed (2026-07-19: combat-variant coverage)", () => {
    const { scene, setAfterburner, setConsumable, setComms } = makeScene({
      combatants: [foe("npc_a")],
    });
    confirmPlanningIfOpen(scene, {
      preferredTargetId: "npc_a",
      afterburner: true,
      consumableId: "con_shield_cell",
      commsAction: "demand-surrender",
    });
    expect(setAfterburner).toHaveBeenCalledWith(true);
    expect(setConsumable).toHaveBeenCalledWith("con_shield_cell");
    expect(setComms).toHaveBeenCalledWith("demand-surrender");
  });

  it("explicit null clears a previously-set consumable/comms choice", () => {
    const { scene, setConsumable, setComms } = makeScene({
      combatants: [foe("npc_a")],
    });
    confirmPlanningIfOpen(scene, {
      preferredTargetId: "npc_a",
      consumableId: null,
      commsAction: null,
    });
    expect(setConsumable).toHaveBeenCalledWith(null);
    expect(setComms).toHaveBeenCalledWith(null);
  });

  it("does not throw when the scene lacks setAfterburner/setConsumable/setComms (older stub)", () => {
    const assignWeapon = vi.fn();
    const confirm = vi.fn(() => true);
    const scene = {
      combatPlanning: {
        isPlanning: true,
        assignWeapon,
        setDestination: vi.fn(),
        confirm,
      },
      combatModule: {
        fittedWeapons: () => [],
        combatants: new Set([foe("npc_a")]),
        selectedTarget: null,
      },
      shipPhysics: { shipX: 0, shipY: 0 },
    };
    expect(() =>
      confirmPlanningIfOpen(scene, {
        preferredTargetId: "npc_a",
        afterburner: true,
        consumableId: "con_shield_cell",
        commsAction: "demand-surrender",
      }),
    ).not.toThrow();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("weaponClassAwareTargeting routes MISSILE-class weapons at the farthest combatant with >=2 hostiles present", () => {
    const near = foe("npc_near", 50, 0);
    const far = foe("npc_far", 500, 0);
    const { scene, assignWeapon } = makeScene({
      combatants: [near, far],
      weapons: [
        { id: "beam", weaponClass: "ENERGY" },
        { id: "missile", weaponClass: "MISSILE" },
      ],
    });
    confirmPlanningIfOpen(scene, {
      preferredTargetId: "npc_near",
      weaponClassAwareTargeting: true,
    });
    const beamCall = assignWeapon.mock.calls.find((c) => c[0].id === "beam");
    const missileCall = assignWeapon.mock.calls.find(
      (c) => c[0].id === "missile",
    );
    expect(beamCall?.[1]).toBe(near); // non-missile stays on the picked target
    expect(missileCall?.[1]).toBe(far); // missile splits onto the other hostile
  });

  it("weaponClassAwareTargeting is a no-op with only one combatant (both weapons on the same target)", () => {
    const only = foe("npc_a");
    const { scene, assignWeapon } = makeScene({
      combatants: [only],
      weapons: [{ id: "missile", weaponClass: "MISSILE" }],
    });
    confirmPlanningIfOpen(scene, {
      preferredTargetId: "npc_a",
      weaponClassAwareTargeting: true,
    });
    expect(assignWeapon).toHaveBeenCalledWith(
      { id: "missile", weaponClass: "MISSILE" },
      only,
    );
  });

  it("weaponClassAwareTargeting off (default) keeps every weapon, missile included, on the one picked target", () => {
    const near = foe("npc_near", 50, 0);
    const far = foe("npc_far", 500, 0);
    const { scene, assignWeapon } = makeScene({
      combatants: [near, far],
      weapons: [{ id: "missile", weaponClass: "MISSILE" }],
    });
    confirmPlanningIfOpen(scene, { preferredTargetId: "npc_near" });
    expect(assignWeapon).toHaveBeenCalledWith(
      { id: "missile", weaponClass: "MISSILE" },
      near,
    );
  });
});
