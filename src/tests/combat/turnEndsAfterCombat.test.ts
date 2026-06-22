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
 * Task 4 — the active-pause resolves and the route-turn ends cleanly.
 *
 * Before the fix, the host wired `onCombatEnded` only to {@link
 * CombatPauseController.reset} (re-arm the pause debounce). Nothing ended the
 * turn, so a fight that resolved while the route-"Ход" flag was set left
 * `isTurnRunning` stuck true — a stationary "wait" turn that kept advancing the
 * calendar after the last enemy died ("ход не кончается после выстрела"). The
 * fix wires `onCombatEnded` to also call `SpaceFlightScene.endTurn()` (skipped on
 * teardown so a terminal scene isn't autosaved).
 *
 * This suite reconstructs that exact wiring in a tiny fake host — a real {@link
 * CombatModule} + {@link CombatPauseController} plus a `turnRunning` flag whose
 * `endTurn()` is wired into `onCombatEnded` the way the scene now does — and
 * drives the full lifecycle through the real fire path: requestPause → confirm →
 * resume → last combatant removed → combat ends → the turn-running projection
 * clears. Pure — no PixiJS render context.
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
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

function makeSprite(id: string, x: number, hullHP = 100): NpcShipSprite {
  return {
    x,
    y: 0,
    npc: { id, name: id, hullHP, maxHull: 100, damage: 20 },
  } as unknown as NpcShipSprite;
}

interface FakeHost {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  /** The raw route-turn flag (SpaceFlightScene.isTurnRunning). */
  turnRunning: () => boolean;
  /** Effective turn state pushed to the HUD: isTurnRunning && !paused. */
  effectiveTurnRunning: () => boolean;
  endedCount: () => number;
  pauseReason: () => PauseReason | null;
  destroyed: NpcShipSprite[];
  weapon: () => WeaponSpec;
}

/**
 * Wire the module/controller exactly the way `SpaceFlightScene` does after the
 * Task 4 fix: `onCombatEnded` re-arms the debounce AND ends the turn. The fake
 * `endTurn` only clears the flag (the scene also settles the ship + autosaves —
 * irrelevant to the lifecycle under test).
 */
function makeHost(): FakeHost {
  let isTurnRunning = true; // a route-"Ход" is in progress
  let endedCount = 0;
  let reason: PauseReason | null = null;
  const destroyed: NpcShipSprite[] = [];

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
    // Production gates fire on the active-pause only (real-time, not the turn).
    isPaused: () => controller.paused,
    onPlayerUnderAttack: () => {
      controller.requestPause("incoming-attack");
    },
    onTargetLost: (npc) => controller.loseTarget(npc),
    onNpcDestroyed: (s) => {
      destroyed.push(s);
    },
    onCombatEnded: () => {
      endedCount += 1;
      controller.reset(); // re-arm pause debounce
      isTurnRunning = false; // Task 4: combat over → end the turn
    },
  };
  const module = new CombatModule(deps);

  return {
    module,
    controller,
    turnRunning: () => isTurnRunning,
    effectiveTurnRunning: () => isTurnRunning && !controller.paused,
    endedCount: () => endedCount,
    pauseReason: () => reason,
    destroyed,
    weapon: () => module.fittedWeapons()[0],
  };
}

describe("the turn ends cleanly when combat resolves (Task 4)", () => {
  it("pause → confirm a lethal shot on the last enemy → combat ends → turn-running clears", () => {
    const host = makeHost();
    const enemy = makeSprite("a", 50, 14); // in range; one confirmed pulse is lethal
    host.module.addCombatant(enemy);

    // An incoming shot pauses the fight; the player confirms a kill on the only
    // enemy. confirm() resumes time, fires, and empties the combatant set.
    host.controller.requestPause("incoming-attack");
    expect(host.effectiveTurnRunning()).toBe(false); // frozen while paused

    host.controller.selectTarget(enemy);
    host.controller.selectWeapon(host.weapon());
    expect(host.controller.confirm()).not.toBeNull();

    expect(enemy.npc.hullHP).toBe(0);
    expect(host.destroyed).toEqual([enemy]); // bounty/kill hook fired
    expect(host.controller.paused).toBe(false); // resumed after the confirmed shot
    // The kill emptied the set but endCombat runs on the next module tick.
    expect(host.module.isActive).toBe(true);
    expect(host.turnRunning()).toBe(true); // not ended yet

    // One frame with the set emptied resolves the fight and ends the turn.
    host.module.update(1);

    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
    expect(host.turnRunning()).toBe(false); // Task 4: isTurnRunning cleared
    expect(host.effectiveTurnRunning()).toBe(false);
  });

  it("real-time auto-fire kills the last enemy → combat ends → turn-running clears (no manual confirm)", () => {
    const host = makeHost();
    const enemy = makeSprite("a", 50, 14); // dies to one auto pulse before it can fire back
    host.module.addCombatant(enemy);

    // One interval: the player's auto-fire (resolved before the NPC fire loop)
    // kills the only enemy, so no incoming shot ever pauses the fight.
    host.module.update(FIRE);

    expect(host.controller.paused).toBe(false); // never paused — clean real-time kill
    expect(host.pauseReason()).toBeNull();
    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
    expect(host.turnRunning()).toBe(false);
    expect(host.effectiveTurnRunning()).toBe(false);
  });

  it("Продолжить (resume without firing) keeps the turn live, then resolves and ends it on the last loss", () => {
    const host = makeHost();
    const a = makeSprite("a", 50, 100); // selected
    const b = makeSprite("b", 60, 100); // survivor
    host.module.addCombatant(a);
    host.module.addCombatant(b);

    // Incoming shot pauses; the player declines to fire (Продолжить / Esc).
    host.controller.requestPause("incoming-attack");
    expect(host.effectiveTurnRunning()).toBe(false);
    host.controller.resume();

    // Resumed: the fight is still live in real time — the turn must NOT be stuck
    // ended, nor frozen.
    expect(host.controller.paused).toBe(false);
    expect(host.module.isActive).toBe(true);
    expect(host.turnRunning()).toBe(true);
    expect(host.effectiveTurnRunning()).toBe(true);

    // Both combatants open the gap beyond escape range and break off — the fight
    // ends with no combatant left (never an empty-overlay re-pause), turn clears.
    a.x = ESCAPE + 300;
    b.x = ESCAPE + 300;
    host.module.update(FIRE);

    expect(host.module.isActive).toBe(false);
    expect(host.controller.paused).toBe(false); // no pause onto an empty overlay
    expect(host.endedCount()).toBe(1);
    expect(host.turnRunning()).toBe(false);
    expect(host.effectiveTurnRunning()).toBe(false);
  });

  it("target-lost re-pause then a confirmed kill of the last survivor ends the turn", () => {
    const host = makeHost();
    const a = makeSprite("a", 50, 14); // selected; one auto pulse is lethal
    const b = makeSprite("b", 60, 14); // survivor; one confirmed pulse is lethal
    host.module.addCombatant(a);
    host.module.addCombatant(b);

    // Auto-fire kills `a`; a survivor remains → re-pause onto `b` (target-lost).
    host.module.update(FIRE);
    expect(host.controller.paused).toBe(true);
    expect(host.pauseReason()).toBe("target-lost");
    expect(host.module.selectedTarget).toBe(b);
    expect(host.turnRunning()).toBe(true); // still engaged — not ended yet

    // The player confirms the kill on the last survivor; the set empties.
    host.controller.selectTarget(b);
    host.controller.selectWeapon(host.weapon());
    expect(host.controller.confirm()).not.toBeNull();
    expect(b.npc.hullHP).toBe(0);
    expect(host.controller.paused).toBe(false);

    // The emptied set resolves on the next tick and the turn ends cleanly.
    host.module.update(1);

    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
    expect(host.turnRunning()).toBe(false);
    expect(host.effectiveTurnRunning()).toBe(false);
  });
});
