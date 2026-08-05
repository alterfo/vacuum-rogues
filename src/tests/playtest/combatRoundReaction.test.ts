import { describe, it, expect, vi } from "vitest";
import { CombatModule } from "@/presentation/flight/CombatModule";
import { CombatPauseController } from "@/presentation/flight/combatPause";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";
import { roundDamageBudget } from "@/systems/combat/combatRounds";
import type { GameMode } from "@/types";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs;

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
    stop(): void {},
  } as unknown as ShipPhysics;
}

function makeHostile(id: string, x: number, damage: number): NpcShipSprite {
  return {
    x,
    y: 0,
    npc: {
      id,
      name: id,
      hullHP: 1_000_000, // effectively unkillable so the fight persists (garrison)
      maxHull: 1_000_000,
      damage,
    },
  } as unknown as NpcShipSprite;
}

function setup(opts: { mode?: GameMode; maxHull?: number } = {}): {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  ship: { hullHP: number; maxHull: number };
  deaths: () => number;
  resumeFromOverlay: () => void;
} {
  const maxHull = opts.maxHull ?? 130;
  const ship = { hullHP: maxHull, maxHull };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  let deaths = 0;

  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>();
  const module = new CombatModule({
    getShipPhysics: () => makePhysics(),
    isPaused: () => controller.paused,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    getGameMode: () => opts.mode ?? "NORMAL",
    isHostileSystem: () => true,
    getCampaignPeakPower: () => 0, // weakest player ⇒ round mechanic fully engaged
    onPlayerDestroyed: () => {
      deaths++;
    },
    onPlayerUnderAttack: () => controller.requestPause("incoming-attack"),
    onRoundComplete: () => controller.repause(),
    onCombatEnded: () => controller.reset(),
  });

  const resumeFromOverlay = (): void => {
    module.beginCombatRound();
    controller.resume();
  };

  return { module, controller, ship, deaths: () => deaths, resumeFromOverlay };
}

describe("Round-based combat reaction window (Task 9 (v), real engine)", () => {
  it("a full-hull weak ship can NEVER be dropped to zero inside one round", () => {
    const { module, controller, ship, resumeFromOverlay } = setup({
      maxHull: 130,
    });
    for (const [i, id] of ["a", "b", "c", "d"].entries())
      module.addCombatant(makeHostile(id, 40 + i * 10, 40));

    module.update(FIRE);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBeGreaterThan(0);

    resumeFromOverlay();
    for (let i = 0; i < 40 && !controller.paused; i++) module.update(FIRE);

    expect(module.roundComplete).toBe(true);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBeGreaterThan(0);
    const budget = roundDamageBudget(130, {
      hullFraction: GAME_BALANCE.combatRoundHullFraction,
    });
    expect(130 - ship.hullHP).toBeGreaterThan(0); // fire landed
    expect(130 - ship.hullHP).toBeLessThan(130); // but never the whole hull
    expect(budget).toBeLessThan(130); // the budget itself guarantees the invariant
  });

  it("a committed fight (resuming round after round) still loses — fleeing has a cost", () => {
    const { module, controller, deaths, resumeFromOverlay } = setup({
      maxHull: 130,
    });
    for (const [i, id] of ["a", "b", "c"].entries())
      module.addCombatant(makeHostile(id, 40 + i * 10, 40));

    let rounds = 0;
    for (let frame = 0; frame < 200 && deaths() === 0; frame++) {
      if (controller.paused) {
        resumeFromOverlay();
        rounds++;
      }
      module.update(FIRE);
    }
    expect(deaths()).toBe(1);
    expect(rounds).toBeGreaterThanOrEqual(2);
  });

  it("declining to resume (fleeing) halts incoming fire — the ship survives the window", () => {
    const { module, ship } = setup({ maxHull: 130 });
    for (const [i, id] of ["a", "b", "c"].entries())
      module.addCombatant(makeHostile(id, 40 + i * 10, 40));

    module.update(FIRE);
    const hullAtFlee = ship.hullHP;
    for (let i = 0; i < 40; i++) module.update(FIRE);
    expect(ship.hullHP).toBe(hullAtFlee);
    expect(ship.hullHP).toBeGreaterThan(0);
  });

  it("a fatal shot that also crosses the round budget never reopens the pause on a later frame (regression)", () => {
    const maxHull = 10;
    const ship = { hullHP: maxHull, maxHull };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    let deaths = 0;
    let roundCompletions = 0;
    const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>();
    const module = new CombatModule({
      getShipPhysics: () => makePhysics(),
      isPaused: () => controller.paused,
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      getGameMode: () => "NORMAL",
      isHostileSystem: () => true,
      getCampaignPeakPower: () => 0,
      onPlayerDestroyed: () => {
        deaths++;
      },
      onPlayerUnderAttack: () => controller.requestPause("incoming-attack"),
      onRoundComplete: () => {
        roundCompletions++;
        controller.repause();
      },
      onCombatEnded: () => controller.reset(),
    });
    module.addCombatant(makeHostile("a", 40, 3));
    module.addCombatant(makeHostile("b", 50, 20));

    module.update(FIRE);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBe(8);
    expect(deaths).toBe(0);

    module.beginCombatRound();
    controller.resume();
    module.update(FIRE + GAME_BALANCE.combatJoinFireStaggerMs);
    expect(deaths).toBe(1);

    module.update(FIRE);
    expect(deaths).toBe(1); // still exactly one death
    expect(roundCompletions).toBe(0);
    expect(module.roundComplete).toBe(false);
  });

  it("GOD keeps the flat fight — the hull floor already prevents the death, so no rounds", () => {
    const { module, controller, ship } = setup({ mode: "GOD", maxHull: 130 });
    module.addCombatant(makeHostile("a", 50, 40));
    module.update(FIRE); // first shot → existing active pause
    expect(module.roundComplete).toBe(false);
    controller.resume();
    for (let i = 0; i < 20; i++) module.update(FIRE);
    expect(module.roundComplete).toBe(false);
    expect(ship.hullHP).toBeGreaterThan(0);
  });
});
