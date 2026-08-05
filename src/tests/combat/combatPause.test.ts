import { describe, it, expect, vi } from "vitest";
import {
  CombatPauseController,
  type PauseAttackAction,
} from "@/presentation/flight/combatPause";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

type Target = { id: string };
type Weapon = { id: string };

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms

describe("CombatPauseController auto-pause + confirm (Task 1)", () => {
  it("an incoming attack pauses; selecting target+weapon then confirm fires once and resumes", () => {
    const onConfirm = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({
      onConfirm,
      onPause,
      onResume,
    });
    const target: Target = { id: "a" };
    const weapon: Weapon = { id: "pulse" };

    expect(c.paused).toBe(false);
    expect(c.requestPause("incoming-attack")).toBe(true);
    expect(c.paused).toBe(true);
    expect(onPause).toHaveBeenCalledWith("incoming-attack");

    c.selectTarget(target);
    c.selectWeapon(weapon);
    expect(c.selectedTarget).toBe(target);
    expect(c.selectedWeapon).toBe(weapon);

    const action = c.confirm();
    expect(action).toEqual<PauseAttackAction<Target, Weapon>>({
      target,
      weapon,
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(c.paused).toBe(false);
  });

  it("a second confirm while running fires nothing (exactly one attack per pause)", () => {
    const onConfirm = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onConfirm });
    c.requestPause("incoming-attack");
    c.selectTarget({ id: "a" });
    c.selectWeapon({ id: "pulse" });
    c.confirm();
    expect(c.confirm()).toBeNull(); // not paused anymore
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("explicit resume without acting does not fire", () => {
    const onConfirm = vi.fn();
    const onResume = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({
      onConfirm,
      onResume,
    });
    c.requestPause("incoming-attack");
    c.selectTarget({ id: "a" });
    c.selectWeapon({ id: "pulse" });
    c.resume();
    expect(c.paused).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("resume while not paused is a no-op", () => {
    const onResume = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onResume });
    c.resume();
    expect(c.paused).toBe(false);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("confirm with no weapon selected is graceful: no fire, stays paused", () => {
    const onConfirm = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onConfirm });
    c.requestPause("incoming-attack");
    c.selectTarget({ id: "a" }); // no weapon
    expect(c.confirm()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(c.paused).toBe(true); // overlay stays open to surface the message
  });

  it("confirm with no target selected is graceful: no fire, stays paused", () => {
    const onConfirm = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onConfirm });
    c.requestPause("incoming-attack");
    c.selectWeapon({ id: "pulse" }); // no target
    expect(c.confirm()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(c.paused).toBe(true);
  });

  it("confirm while not paused (no prior attack) is a no-op", () => {
    const onConfirm = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onConfirm });
    c.selectTarget({ id: "a" });
    c.selectWeapon({ id: "pulse" });
    expect(c.confirm()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("CombatPauseController incoming-attack debounce (Task 1)", () => {
  it("only the first incoming shot per engagement pauses; later shots after resume do not", () => {
    const onPause = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onPause });

    expect(c.requestPause("incoming-attack")).toBe(true);
    c.resume();
    expect(c.requestPause("incoming-attack")).toBe(false);
    expect(c.requestPause("incoming-attack")).toBe(false);
    expect(c.paused).toBe(false);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("requestPause while already paused does not re-fire onPause", () => {
    const onPause = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onPause });
    expect(c.requestPause("incoming-attack")).toBe(true);
    expect(c.requestPause("incoming-attack")).toBe(false); // already paused (and consumed)
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("reset re-arms the debounce so the next engagement pauses again", () => {
    const onPause = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onPause });
    c.requestPause("incoming-attack");
    c.resume();
    c.reset(); // engagement ended
    expect(c.requestPause("incoming-attack")).toBe(true); // fresh fight pauses again
    expect(onPause).toHaveBeenCalledTimes(2);
  });

  it("reset clears the pending selection", () => {
    const c = new CombatPauseController<Target, Weapon>();
    c.selectTarget({ id: "a" });
    c.selectWeapon({ id: "pulse" });
    c.reset();
    expect(c.selectedTarget).toBeNull();
    expect(c.selectedWeapon).toBeNull();
  });
});

describe("CombatPauseController target-lost re-pause (Task 1)", () => {
  it("losing the selected target re-pauses (reason target-lost) and clears it", () => {
    const onPause = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onPause });
    const target: Target = { id: "a" };

    c.requestPause("incoming-attack");
    c.selectTarget(target);
    c.selectWeapon({ id: "pulse" });
    c.confirm(); // fired and resumed — now drifting in real time
    expect(c.paused).toBe(false);

    expect(c.notifyTargetLost(target)).toBe(true);
    expect(c.paused).toBe(true);
    expect(c.selectedTarget).toBeNull(); // forces a fresh pick
    expect(onPause).toHaveBeenLastCalledWith("target-lost");
  });

  it("losing a non-selected target does not re-pause", () => {
    const c = new CombatPauseController<Target, Weapon>();
    const a: Target = { id: "a" };
    const b: Target = { id: "b" };
    c.requestPause("incoming-attack");
    c.selectTarget(a);
    c.selectWeapon({ id: "pulse" });
    c.confirm();
    expect(c.notifyTargetLost(b)).toBe(false); // b was never the selection
    expect(c.paused).toBe(false);
  });

  it("target-lost is not gated by the incoming-attack debounce", () => {
    const c = new CombatPauseController<Target, Weapon>();
    const a: Target = { id: "a" };
    c.requestPause("incoming-attack"); // consumes the incoming-attack trigger
    c.selectTarget(a);
    c.selectWeapon({ id: "pulse" });
    c.confirm();
    expect(c.notifyTargetLost(a)).toBe(true);
    expect(c.paused).toBe(true);
  });

  it("losing the selected target while already paused just clears it (no double-pause)", () => {
    const onPause = vi.fn();
    const c = new CombatPauseController<Target, Weapon>({ onPause });
    const a: Target = { id: "a" };
    c.requestPause("incoming-attack");
    c.selectTarget(a);
    expect(c.notifyTargetLost(a)).toBe(false); // already paused — no fresh pause
    expect(c.selectedTarget).toBeNull();
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

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
    npc: { id, name: id, hullHP: 100, damage },
  } as unknown as NpcShipSprite;
}

describe("CombatModule raises onPlayerUnderAttack (Task 1)", () => {
  function makeModule(onPlayerUnderAttack: () => void): CombatModule {
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ({ hullHP: 100, maxHull: 100 }),
      onPlayerUnderAttack,
    };
    return new CombatModule(deps);
  }

  it("fires the trigger when an NPC shot lands on the player", () => {
    const onPlayerUnderAttack = vi.fn();
    const module = makeModule(onPlayerUnderAttack);
    module.addCombatant(makeSprite("a", 50, 0));
    expect(onPlayerUnderAttack).not.toHaveBeenCalled(); // no shot yet
    module.update(FIRE); // interval elapses → NPC fires
    expect(onPlayerUnderAttack).toHaveBeenCalled();
  });

  it("does not fire the trigger before the NPC's first shot lands", () => {
    const onPlayerUnderAttack = vi.fn();
    const module = makeModule(onPlayerUnderAttack);
    module.addCombatant(makeSprite("a", 50, 0));
    module.update(FIRE - 100); // short of the interval — no shot
    expect(onPlayerUnderAttack).not.toHaveBeenCalled();
  });
});
