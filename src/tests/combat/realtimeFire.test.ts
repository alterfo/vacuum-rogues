import { describe, it, expect } from "vitest";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 2 — real-time fire decoupled from the route-turn (NPCs shoot back).
 *
 * Before the fix the module gated fire on `isTurnRunning?.() === false`, and the
 * scene folded the route-"Ход" into that signal
 * (`isTurnRunning: () => this.isTurnRunning && !paused`). So an engaged fight
 * only ticked while a route-turn was executing — in practice NPCs never shot
 * back and the player couldn't auto-fire outside a turn. The fix gives the
 * module an explicit {@link CombatModuleDeps.isPaused} dep so combat is gated on
 * the active-pause **only** — it ticks in real time whether or not a turn runs.
 *
 * These tests wire the deps the production way (an `isPaused` signal) AND assert
 * that fire advances even with `isTurnRunning` reporting **false** (no route-turn
 * running) — which would have frozen the old turn-gated module. Pure — no PixiJS
 * render context.
 */

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE_DMG = 14; // wpn_pulse damage (range 240) — see combatModule.test.ts
const NPC_DMG = 20;

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
  damage = NPC_DMG,
): NpcShipSprite {
  return {
    x,
    y,
    npc: { id, name: id, hullHP: 100, maxHull: 100, damage },
  } as unknown as NpcShipSprite;
}

describe("real-time fire decoupled from the route-turn (Task 2)", () => {
  it("both sides fire with no route-turn running, as long as the active-pause is down", () => {
    let paused = false;
    const ship = { hullHP: 100, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      // Production-style: combat is frozen ONLY by the active-pause. The route
      // turn is explicitly NOT running — the old turn-gated module froze here.
      isPaused: () => paused,
      isTurnRunning: () => false,
      onPlayerUnderAttack: () => {
        paused = true;
      },
    };
    const module = new CombatModule(deps);
    const enemy = makeSprite("a", 50, 0); // inside pulse range (240) and NPC weaponRange
    module.addCombatant(enemy); // auto-selects `enemy` as the player's target

    module.update(FIRE);

    expect(enemy.npc.hullHP).toBe(100 - PULSE_DMG); // player auto-fired despite no turn
    expect(ship.hullHP).toBe(100 - NPC_DMG); // NPC shot back
    expect(paused).toBe(true); // first incoming hit raised the active-pause
  });

  it("while paused, neither side fires even though the route-turn reports running", () => {
    let paused = false;
    const ship = { hullHP: 100, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      // isPaused is the sole freeze signal — a "running" turn must NOT thaw a
      // frozen (paused) fight.
      isPaused: () => paused,
      isTurnRunning: () => true,
      onPlayerUnderAttack: () => {
        paused = true;
      },
    };
    const module = new CombatModule(deps);
    const enemy = makeSprite("a", 50, 0);
    module.addCombatant(enemy);

    module.update(FIRE); // first exchange fires, then pauses on the incoming hit
    const shipHullAfterPause = ship.hullHP;
    const enemyHullAfterPause = enemy.npc.hullHP;
    expect(paused).toBe(true);

    // Several full fire intervals pass while the overlay is open — nothing fires.
    module.update(FIRE);
    module.update(FIRE * 3);

    expect(ship.hullHP).toBe(shipHullAfterPause); // player hull frozen
    expect(enemy.npc.hullHP).toBe(enemyHullAfterPause); // enemy hull frozen
  });

  it("each engaged NPC returns fire every combatFireIntervalMs once the pause is resumed", () => {
    let paused = false;
    const ship = { hullHP: 100, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const deps: CombatModuleDeps = {
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      isPaused: () => paused,
      isTurnRunning: () => false, // no route-turn — pure real-time fight
      onPlayerUnderAttack: () => {
        paused = true;
      },
    };
    const module = new CombatModule(deps);
    module.addCombatant(makeSprite("a", 50, 0));

    module.update(FIRE); // first exchange → pauses
    expect(ship.hullHP).toBe(100 - NPC_DMG);
    paused = false; // player resumes without firing (debounce keeps it live)

    module.update(FIRE); // a second real-time interval — the NPC fires again
    expect(ship.hullHP).toBe(100 - NPC_DMG * 2);
  });
});
