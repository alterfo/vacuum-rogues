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
 * Task 1 (target-lost re-pause) — wired end-to-end through the real module.
 *
 * The pure controller's `notifyTargetLost` is unit-tested in combatPause.test.ts,
 * but that proves nothing about production: the controller only re-pauses if the
 * scene actually drives it when the *current* auto-fire target dies / leaves. This
 * suite wires a real {@link CombatModule} to a {@link CombatPauseController} exactly
 * the way `SpaceFlightScene` does (the `onTargetLost` adapter), then kills / strands
 * combatants through the real fire path and asserts the re-pause fires (or doesn't).
 * No render context.
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE_RANGE = 240; // wpn_pulse range
const ESCAPE = GAME_BALANCE.combatEscapeRange; // 1200

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
  hullHP = 100,
  damage = 20,
): NpcShipSprite {
  return {
    x,
    y: 0,
    npc: { id, name: id, hullHP, maxHull: 100, damage },
  } as unknown as NpcShipSprite;
}

function makeFight(): {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  ship: { hullHP: number; maxHull: number };
  pauseReason: () => PauseReason | null;
} {
  let reason: PauseReason | null = null;
  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>({
    onPause: (r) => {
      reason = r;
    },
    onConfirm: (a) => module.confirmAttack(a.target, a.weapon),
  });
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // dmg 14, range 240
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    isTurnRunning: () => !controller.paused,
    onPlayerUnderAttack: () => {
      controller.requestPause("incoming-attack");
    },
    // Exactly what SpaceFlightScene wires (sync selection, then re-pause).
    onTargetLost: (npc) => controller.loseTarget(npc),
  };
  const module = new CombatModule(deps);
  return { module, controller, ship, pauseReason: () => reason };
}

describe("target-lost re-pause (production wiring)", () => {
  it("re-pauses when the selected target dies and a survivor remains", () => {
    const { module, controller, pauseReason } = makeFight();
    const a = makeSprite("a", 50, 10); // selected, dies to one pulse (14 dmg)
    const b = makeSprite("b", 60, 100); // survivor, in range
    module.addCombatant(a);
    module.addCombatant(b);
    expect(module.selectedTarget).toBe(a);

    // One interval: the player's auto-fire kills `a`; the module must re-pause
    // onto `b` rather than silently auto-continuing the fight in real time.
    module.update(FIRE);

    expect(controller.paused).toBe(true);
    expect(pauseReason()).toBe("target-lost");
    expect(module.selectedTarget).toBe(b); // re-picked survivor
  });

  it("re-pauses when a CONFIRMED kill of the selected target leaves a survivor", () => {
    // Regression: the confirm path fires through the controller while still paused.
    // If `confirm()` ran `onConfirm` (the kill) before leaving the pause, the
    // synchronous target-lost re-pause hit the already-paused guard and was
    // swallowed — dropping the player back into real time against the survivor.
    const { module, controller, pauseReason } = makeFight();
    const a = makeSprite("a", 50, 14); // selected; 14 HP — one confirmed pulse is lethal
    const b = makeSprite("b", 60, 100); // survivor, in range
    module.addCombatant(a);
    module.addCombatant(b);
    expect(module.selectedTarget).toBe(a);

    // Pause without auto-fire, then the player confirms a lethal shot on `a`.
    controller.requestPause("incoming-attack");
    controller.selectTarget(a);
    controller.selectWeapon(module.fittedWeapons()[0]);
    const action = controller.confirm();

    expect(action).not.toBeNull();
    expect(a.npc.hullHP).toBe(0); // killed by the confirmed shot
    // The confirmed kill lost the selected target while `b` survives → re-pause so
    // the player picks a new target instead of drifting into real time.
    expect(controller.paused).toBe(true);
    expect(pauseReason()).toBe("target-lost");
    expect(module.selectedTarget).toBe(b); // re-picked survivor
  });

  it("does NOT fire the player's auto-shot on the frame a prune-triggered re-pause is raised", () => {
    // Regression: pruneDisengaged() can drop the *selected* target (drifted beyond
    // escape range) and synchronously raise a target-lost pause via
    // onTargetLost → loseTarget → enterPause, BEFORE advancePlayerTimer() runs in
    // the same update(). Without a freeze re-check between prune and the player's
    // auto-fire, the player landed a free shot on the re-picked survivor on the
    // very frame the world was meant to freeze.
    const { module, controller, pauseReason } = makeFight();
    const a = makeSprite("a", ESCAPE + 300, 100); // selected, already beyond escape range
    const b = makeSprite("b", 60, 100); // survivor, inside weapon range
    module.addCombatant(a); // auto-selected (first combatant)
    module.addCombatant(b);
    expect(module.selectedTarget).toBe(a);

    // First interval: prune removes `a` (escaped) and re-pauses onto `b`. The
    // player's fire timer is ready this frame, but the pause must suppress the shot.
    module.update(FIRE);

    expect(controller.paused).toBe(true);
    expect(pauseReason()).toBe("target-lost");
    expect(module.selectedTarget).toBe(b); // re-picked survivor
    expect(b.npc.hullHP).toBe(100); // NO shot landed on the pausing frame
  });

  it("does NOT re-pause when the last combatant dies (fight ends cleanly)", () => {
    const { module, controller, pauseReason } = makeFight();
    const a = makeSprite("a", 50, 10); // only combatant, dies to one pulse
    module.addCombatant(a);

    module.update(FIRE);

    expect(module.isActive).toBe(false); // endCombat ran
    expect(controller.paused).toBe(false); // no empty-overlay pause
    expect(pauseReason()).toBeNull();
  });

  it("does NOT raise target-lost when a NON-selected combatant is lost", () => {
    const { module, controller, pauseReason } = makeFight();
    // Selected target sits beyond weapon range (no fire either way), within the
    // escape range so it stays engaged. A second, non-selected combatant drifts
    // past the escape range and is pruned — that loss must not re-pause.
    const a = makeSprite("a", PULSE_RANGE + 60, 100); // selected, out of weapon range
    const b = makeSprite("b", ESCAPE + 300, 100); // non-selected, beyond escape range
    module.addCombatant(a);
    module.addCombatant(b);
    expect(module.selectedTarget).toBe(a);

    module.update(FIRE);

    expect(module.combatants.has(b)).toBe(false); // pruned
    expect(module.selectedTarget).toBe(a); // selection unchanged
    expect(controller.paused).toBe(false); // losing a non-selected ship did not pause
    expect(pauseReason()).toBeNull();
  });
});
