import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcRole } from "@/types";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 3 (combat-balance-pass): **escape actually works after the speed fix.**
 *
 * The economy plan made a fresh starter ship (corvette + `eq_engine_i`, tech 2 →
 * 0.05 + 2×0.03 = 0.11 px/ms) out-run a *basic* NPC (`npcBasicSpeed` 0.08) while
 * still being unable to flee a rare *interceptor* (`npcSpeed` 0.2, upgrade-gated).
 * This scenario proves the consequence end-to-end over the **real** engine: the
 * genuine loadout-derived cruise speed, the real `CombatModule` disengage-at-
 * `combatEscapeRange` seam, and the real balance constants — only PixiJS is
 * stubbed (same harness as `journeys.test.ts`).
 *
 * The NPC pursuit is modelled as a *straight-line* chase at the real
 * `npcCruiseSpeed` (the strongest possible pursuit — no arc waste), so a player
 * escape here is conservative: the in-game arc-steered chase only ever opens the
 * gap faster. The fight ends through the real `CombatModule` (a combatant the
 * player opens beyond `combatEscapeRange` is pruned, emptying the set → the fight
 * ends), not a test shortcut.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const ESCAPE = GAME_BALANCE.combatEscapeRange; // 1200 world px
const BASIC = GAME_BALANCE.npcBasicSpeed; // 0.08 — ordinary trader/patrol cruise
const INTERCEPTOR = GAME_BALANCE.npcSpeed; // 0.20 — rare OVERMIND/PIRATE raider

/** A lightweight hostile sprite — CombatModule reads x/y/npc/container only. */
function makeHostile(
  id: string,
  x: number,
  y: number,
  opts: { role?: NpcRole; hull?: number; damage?: number } = {},
): NpcShipSprite & { x: number; y: number } {
  const hull = opts.hull ?? 1_000_000; // effectively unkillable for the run window
  return {
    x,
    y,
    npc: {
      id,
      name: id,
      role: opts.role ?? NpcRole.TRADER,
      hullHP: hull,
      maxHull: hull,
      damage: opts.damage ?? 20,
    },
  } as unknown as NpcShipSprite & { x: number; y: number };
}

/**
 * Advance a straight-line pursuer toward the player ship by `speed`×dt — the
 * strongest possible chase (it never wastes motion on a turn), so a player
 * escape under it is a conservative result.
 */
function chaseStep(
  sprite: { x: number; y: number },
  physics: ShipPhysics,
  speed: number,
  dt: number,
): void {
  const dx = physics.shipX - sprite.x;
  const dy = physics.shipY - sprite.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const step = Math.min(d, speed * dt);
  sprite.x += (dx / d) * step;
  sprite.y += (dy / d) * step;
}

/** Distance (world px) between a sprite and the player ship. */
function gap(sprite: { x: number; y: number }, physics: ShipPhysics): number {
  return Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
}

describe("In-flight combat escape over the real engine (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  /**
   * Build a real CombatModule wired to the booted engine's loadout, plus a real
   * ShipPhysics at the genuine starter cruise speed. `getPlayerShip` is supplied
   * so the negative case can isolate the speed relationship from hull attrition.
   */
  function flightArena(ship: { hullHP: number; maxHull: number }): {
    cruise: number;
    physics: ShipPhysics;
    combat: CombatModule;
  } {
    const cruise = harness.engine.playerLoadout!.derivedStats().speed;
    const physics = new ShipPhysics(0, 0, cruise); // parked at origin, heading +X
    const combat = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => harness.engine.playerLoadout,
      getPlayerShip: () => ship,
      getGameMode: () => harness.player()!.gameMode,
      isPaused: () => false, // drive the fight in real time (no active pause)
      onPlayerUnderAttack: () => {}, // never pause, so both sides keep firing
      onNpcDestroyed: () => {},
      showMessage: () => {},
    });
    return { cruise, physics, combat };
  }

  it("the real starter cruise speed out-runs a basic NPC but not an interceptor", () => {
    // The speed-fix premise the rest of the scenario relies on: a fresh ship
    // beats a common foe's cruise, yet stays below the rare interceptor tier.
    const cruise = harness.engine.playerLoadout!.derivedStats().speed;
    expect(cruise).toBeGreaterThan(BASIC); // out-runs an ordinary trader/patrol
    expect(cruise).toBeLessThanOrEqual(INTERCEPTOR); // can't flee a raider yet
  });

  it("a fresh ship engages a basic NPC, flees, opens beyond the escape range, and the fight ends", () => {
    // Given a real fresh ship (full hull) and a basic aggressor on its tail.
    const ship = harness.player()!.ship;
    ship.hullHP = ship.maxHull;
    const { physics, combat } = flightArena(ship);
    const npc = makeHostile("basic-tail", -150, 0, { role: NpcRole.TRADER });

    // When the fight engages and the player flees straight ahead (+X), away from
    // the trailing aggressor, which gives chase at its basic cruise speed.
    combat.addCombatant(npc);
    expect(combat.isActive).toBe(true);
    physics.setTarget(100_000, 0);
    for (let i = 0; i < 3000 && combat.isActive; i++) {
      physics.update(50);
      chaseStep(npc, physics, BASIC, 50);
      combat.update(50);
    }

    // Then the player opened past the escape range and the fight ended — and it
    // ended by escaping, not by dying (the ship survived the early volleys).
    expect(combat.isActive).toBe(false);
    expect(gap(npc, physics)).toBeGreaterThan(ESCAPE);
    expect(ship.hullHP).toBeGreaterThan(0);
    expect(harness.errors()).toEqual([]);
  });

  it("a fresh ship can NOT flee an interceptor — the gap never opens, the fight holds", () => {
    // Given a tanky ship (isolate the speed relationship from hull attrition) and
    // a rare interceptor-class aggressor that cruises faster than the starter.
    const ship = { hullHP: 1_000_000, maxHull: 1_000_000 };
    const { physics, combat } = flightArena(ship);
    const npc = makeHostile("interceptor-tail", -150, 0, {
      role: NpcRole.PIRATE,
    });

    // When the player tries the same flee.
    combat.addCombatant(npc);
    expect(combat.isActive).toBe(true);
    physics.setTarget(100_000, 0);
    for (let i = 0; i < 3000; i++) {
      physics.update(50);
      chaseStep(npc, physics, INTERCEPTOR, 50);
      combat.update(50);
    }

    // Then the faster pursuer pins the player: the gap never reaches the escape
    // range, so the fight is still on — escape stays gated behind an engine
    // upgrade (the apex engine that finally out-runs `npcSpeed`).
    expect(combat.isActive).toBe(true);
    expect(gap(npc, physics)).toBeLessThanOrEqual(ESCAPE);
    expect(harness.errors()).toEqual([]);
  });
});
