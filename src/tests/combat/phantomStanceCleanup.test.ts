import { describe, it, expect } from "vitest";
import {
  CombatPauseController,
  type PauseReason,
} from "@/presentation/flight/combatPause";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 9 (vi) — the phantom combat stance is cleaned up even while frozen.
 *
 * The user's primary hypothesis for the win-rate plateau: the ship "freezes in a
 * combat stance — attack radius drawn, NO hostile ships nearby — and just
 * stands." Root cause: {@link CombatModule.update} early-returns on the active
 * pause BEFORE it prunes/ends the fight, so a combatant whose sprite was
 * destroyed by a non-combat path (hyperjumped out / day-tick despawn) leaves a
 * phantom combatant in the set — `isActive` stays true, the HUD attack radius
 * stays drawn, and the ship is frozen on a fight with nothing to fight. Nothing
 * resumes it because the policy sees no hostile to attack/flee.
 *
 * The fix: while frozen, drop destroyed-sprite combatants (fires no weapons, so
 * it is safe under the pause) and end an emptied fight; the host resumes the
 * pause on combat end so the ship isn't left frozen. This reconstructs the exact
 * scene wiring (real module + real controller) — a distance-disengaged LIVE
 * combatant is a paused player's live choice and must NOT be dropped, but a gone
 * sprite must.
 */

const ESCAPE = GAME_BALANCE.combatEscapeRange;

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: false,
    currentSpeed: 0,
    setTarget(_x: number, _y: number): void {},
    stop(): void {},
  } as unknown as ShipPhysics;
}

/** A sprite with a togglable `container.destroyed` (the despawn signal). */
function makeSprite(
  id: string,
  x: number,
): NpcShipSprite & {
  container: { destroyed: boolean };
} {
  return {
    x,
    y: 0,
    container: { destroyed: false },
    npc: { id, name: id, hullHP: 100, maxHull: 100, damage: 20 },
  } as unknown as NpcShipSprite & { container: { destroyed: boolean } };
}

interface Host {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  endedCount: () => number;
  pauseReason: () => PauseReason | null;
}

/** Wire a real module + controller exactly as `SpaceFlightScene` does. */
function makeHost(): Host {
  let endedCount = 0;
  let reason: PauseReason | null = null;
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");

  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>({
    onPause: (r) => {
      reason = r;
    },
    onConfirm: (a) => module.confirmAttack(a.target, a.weapon),
  });

  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    isPaused: () => controller.paused,
    onPlayerUnderAttack: () => controller.requestPause("incoming-attack"),
    onTargetLost: (npc) => controller.loseTarget(npc),
    onCombatEnded: () => {
      endedCount += 1;
      // The scene's exact wiring: resume if paused, then re-arm the debounce.
      if (controller.paused) controller.resume();
      controller.reset();
    },
  };
  const module = new CombatModule(deps);
  return {
    module,
    controller,
    endedCount: () => endedCount,
    pauseReason: () => reason,
  };
}

describe("phantom combat stance is cleaned up while frozen (Task 9 vi)", () => {
  it("ends a frozen fight whose only combatant's sprite was destroyed, and resumes the pause", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    host.module.addCombatant(a);
    expect(host.module.isActive).toBe(true);

    // Freeze the fight (an incoming shot raised the active pause).
    host.controller.requestPause("incoming-attack");
    expect(host.controller.paused).toBe(true);

    // While frozen, a LIVE combatant is a paused player's live choice — a frozen
    // update must NOT end the fight (the stance is legitimate).
    host.module.update(16);
    expect(host.module.isActive).toBe(true);
    expect(host.controller.paused).toBe(true);

    // The combatant's sprite despawns (hyperjumped out / day-tick refresh). Now
    // the stance is phantom: nothing to fight, but the world is frozen.
    a.container.destroyed = true;

    // A frozen update must clean the phantom up: end the fight and resume so the
    // ship isn't stranded in a combat stance with no hostiles.
    host.module.update(16);
    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
    expect(host.controller.paused).toBe(false); // resumed — not left frozen
  });

  it("does NOT drop a live, merely distance-disengaged combatant while frozen", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    host.module.addCombatant(a);
    host.controller.requestPause("incoming-attack");

    // The combatant drifts beyond escape range but its sprite is alive — under a
    // pause this is a live standoff the player is choosing about, not a phantom.
    a.x = ESCAPE + 500;
    host.module.update(16);
    expect(host.module.isActive).toBe(true); // still engaged while frozen
    expect(host.controller.paused).toBe(true);

    // Once resumed (unfrozen), the normal distance prune ends it cleanly.
    host.controller.resume();
    host.module.update(16);
    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
  });

  it("with several combatants, only the destroyed sprite is dropped while frozen", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    const b = makeSprite("b", 60);
    host.module.addCombatant(a);
    host.module.addCombatant(b);
    host.controller.requestPause("incoming-attack");

    a.container.destroyed = true;
    host.module.update(16);
    // `a` gone, `b` alive → still an active fight, still frozen (not a phantom).
    expect(host.module.isActive).toBe(true);
    expect(host.module.combatants.has(a)).toBe(false);
    expect(host.module.combatants.has(b)).toBe(true);
    expect(host.controller.paused).toBe(true);
    expect(host.endedCount()).toBe(0);
  });
});
