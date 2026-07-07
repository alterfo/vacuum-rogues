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

/**
 * Round-based combat with a between-rounds disengage window — campaign Task 9 (v),
 * over the real {@link CombatModule} wired to the real {@link CombatPauseController}
 * exactly as `SpaceFlightScene` wires them (only PixiJS is stubbed — the same
 * "over the real engine" discipline as `combatEscape.test.ts`).
 *
 * The seam under test: a garrison firing on a full-hull weak ship can NEVER drop
 * it from full to zero inside one continuous resolution window — once a round's
 * incoming-damage budget is spent, fire halts and the active pause re-raises (the
 * reaction window). A committed fight (resuming round after round) still loses,
 * so fleeing has a cost — the window is an escape opportunity, not invulnerability.
 */
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

/**
 * Build a CombatModule wired to a real CombatPauseController the same way
 * `SpaceFlightScene` does: incoming fire raises the active pause, a completed
 * round re-raises it (Task 9 (v)), and combat end re-arms the debounce. Campaign
 * scaling deps are wired (mode + peak power) so round-based combat is active.
 */
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

  // Mirror the combat-pause UI's overlay-button seam: resuming from the overlay
  // begins a fresh round (the between-rounds decision was taken) then resumes.
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
    // A dense garrison: four hostiles all in range, hard hitters.
    for (const [i, id] of ["a", "b", "c", "d"].entries())
      module.addCombatant(makeHostile(id, 40 + i * 10, 40));

    // First incoming shot raises the active pause (existing behaviour).
    module.update(FIRE);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBeGreaterThan(0);

    // Resume and let ONE full round resolve. Drive many frames — the round must
    // halt fire (re-pausing) long before the hull reaches zero.
    resumeFromOverlay();
    for (let i = 0; i < 40 && !controller.paused; i++) module.update(FIRE);

    // The round completed as a reaction window, not a death: hull is still
    // positive and a fresh pause is open for the flee/fight decision — the ship
    // was never dropped from full to zero inside the round.
    expect(module.roundComplete).toBe(true);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBeGreaterThan(0);
    // The round did bound a MULTI-shot volley (a garrison firing on a full-hull
    // ship would otherwise stack past 130 in one continuous window) — it removed
    // more than a single shot yet still left the ship alive.
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

    // Commit: every time a reaction window opens, keep fighting. The scout must
    // still die across rounds (the garrison out-DPSes it), proving the window is
    // an escape opportunity, not invulnerability.
    let rounds = 0;
    for (let frame = 0; frame < 200 && deaths() === 0; frame++) {
      if (controller.paused) {
        resumeFromOverlay();
        rounds++;
      }
      module.update(FIRE);
    }
    expect(deaths()).toBe(1);
    // It took MORE than one round to die — the ship was never one-shot from full.
    expect(rounds).toBeGreaterThanOrEqual(2);
  });

  it("declining to resume (fleeing) halts incoming fire — the ship survives the window", () => {
    const { module, ship } = setup({ maxHull: 130 });
    for (const [i, id] of ["a", "b", "c"].entries())
      module.addCombatant(makeHostile(id, 40 + i * 10, 40));

    // First contact pause → the player chooses to flee (never resumes the fight).
    module.update(FIRE);
    const hullAtFlee = ship.hullHP;
    // Even if frames keep ticking while the player plots an escape, a paused/round
    // -complete fight lands no further damage — the reaction window is real.
    for (let i = 0; i < 40; i++) module.update(FIRE);
    expect(ship.hullHP).toBe(hullAtFlee);
    expect(ship.hullHP).toBeGreaterThan(0);
  });

  it("a fatal shot that also crosses the round budget never reopens the pause on a later frame (regression)", () => {
    // Small hull, two hostiles: "a"'s hit is non-lethal (raises the pause,
    // then contributes most of the round budget on resume); "b" (queued
    // behind "a" in the same combatants set) lands the kill on the SAME
    // resumed frame while also pushing roundDamageTaken past the budget. The
    // bug is what happens on the FOLLOWING frame, before the (un-awaited)
    // GAME_OVER transition has torn this module down.
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
    module.addCombatant(makeHostile("b", 50, 10));

    // First contact: only "a" fires this frame (the active pause freezes "b"
    // before its turn) — hull survives (10 → 7).
    module.update(FIRE);
    expect(controller.paused).toBe(true);
    expect(ship.hullHP).toBe(7);
    expect(deaths).toBe(0);

    // Resume into a fresh round: "a" fires again (7 → 4, roundDamageTaken=3,
    // still under budget), then "b" fires behind it in the SAME frame,
    // killing the ship (4 → 0) and pushing roundDamageTaken to 7 — past the
    // ~3.4 budget for a maxHull-10 ship.
    module.beginCombatRound();
    controller.resume();
    module.update(FIRE);
    expect(deaths).toBe(1);

    // The NEXT frame (GAME_OVER transition still pending — it's fired via an
    // un-awaited promise): nothing must advance. completeRound()/
    // onRoundComplete must never fire once death is reported — else the
    // reaction-window pause reopens on an already-dead ship.
    module.update(FIRE);
    expect(deaths).toBe(1); // still exactly one death
    expect(roundCompletions).toBe(0);
    expect(module.roundComplete).toBe(false);
  });

  it("GOD keeps the flat fight — the hull floor already prevents the death, so no rounds", () => {
    const { module, controller, ship } = setup({ mode: "GOD", maxHull: 130 });
    module.addCombatant(makeHostile("a", 50, 40));
    // In GOD the round mechanic is inert: no reaction-window re-pause fires, and
    // the fight resolves exactly as the pre-Task-9(v) flat exchange.
    module.update(FIRE); // first shot → existing active pause
    expect(module.roundComplete).toBe(false);
    // Resume directly (no beginCombatRound needed — rounds are off in GOD).
    controller.resume();
    for (let i = 0; i < 20; i++) module.update(FIRE);
    // The GOD floor stops the hull above zero without any round machinery.
    expect(module.roundComplete).toBe(false);
    expect(ship.hullHP).toBeGreaterThan(0);
  });
});
