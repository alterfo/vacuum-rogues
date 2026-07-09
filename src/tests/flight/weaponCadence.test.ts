import { describe, it, expect } from "vitest";
import {
  CombatModule,
  weaponFireIntervalMs,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { gearById, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { GAME_BALANCE } from "@/config/balance";

const BASE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms per cooldown turn

/** Catalog weapon by id, typed as a WeaponSpec (fixture lookup, not under test). */
function weapon(id: string): WeaponSpec {
  return gearById(id) as WeaponSpec;
}

/** ShipPhysics stand-in carrying only the fields CombatModule reads. */
function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics;
}

/** NpcShipSprite stand-in with the position + npc fields CombatModule touches. */
function makeSprite(
  id: string,
  x: number,
  y: number,
  hullHP: number,
): NpcShipSprite {
  return {
    x,
    y,
    npc: { id, name: id, hullHP, damage: 0 },
  } as unknown as NpcShipSprite;
}

/** A CombatModule fitted with a single catalog weapon, plus its scratch ship. */
function moduleWith(weaponId: string): {
  module: CombatModule;
  ship: { hullHP: number; maxHull: number };
} {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install(weaponId);
  const ship = { hullHP: 100000, maxHull: 100000 }; // tanky: never dies → never ends combat
  const module = new CombatModule({
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
  });
  return { module, ship };
}

/**
 * Drive `module` for `totalMs` in `step`-ms ticks against a tanky in-range target
 * and return how many shots the single fitted weapon landed (inferred from the
 * target's hull loss ÷ per-shot damage).
 */
function countShots(weaponId: string, totalMs: number, step = 50): number {
  const { module } = moduleWith(weaponId);
  const dmg = weapon(weaponId).damage;
  const target = makeSprite("t", 50, 0, 10_000_000); // in range of every weapon, never dies
  module.addCombatant(target);
  for (let elapsed = 0; elapsed < totalMs; elapsed += step) module.update(step);
  return Math.round((10_000_000 - target.npc.hullHP) / dmg);
}

// ---------------------------------------------------------------------------
// weaponFireIntervalMs — pure cadence derivation
// ---------------------------------------------------------------------------
describe("weaponFireIntervalMs (per-weapon cadence)", () => {
  it("scales the base interval by cooldownTurns (cooldownTurns:1 keeps the old flat cadence)", () => {
    expect(weaponFireIntervalMs({ cooldownTurns: 1 })).toBe(BASE);
    expect(weaponFireIntervalMs({ cooldownTurns: 2 })).toBe(BASE * 2);
    expect(weaponFireIntervalMs({ cooldownTurns: 3 })).toBe(BASE * 3);
  });

  it("a cooldownTurns:3 weapon's interval is 3× a cooldownTurns:1 weapon's", () => {
    const slow = weaponFireIntervalMs({ cooldownTurns: 3 });
    const quick = weaponFireIntervalMs({ cooldownTurns: 1 });
    expect(slow / quick).toBeCloseTo(3, 5);
  });

  it("clamps a malformed cooldownTurns:0 to ≥1 (no fire-every-frame)", () => {
    expect(weaponFireIntervalMs({ cooldownTurns: 0 })).toBe(BASE);
  });

  it("the catalog beam (cooldownTurns:3) really fires slower than the pulse (cooldownTurns:1)", () => {
    expect(weaponFireIntervalMs(weapon("wpn_beam"))).toBe(
      weaponFireIntervalMs(weapon("wpn_pulse")) * 3,
    );
  });
});

// ---------------------------------------------------------------------------
// DPS ordering — cadence makes a high-damage weapon a real tradeoff
// ---------------------------------------------------------------------------
describe("cadence is a real tradeoff, not a free upgrade", () => {
  const dps = (id: string): number =>
    weapon(id).damage / weaponFireIntervalMs(weapon(id));

  it("the beam hits harder per shot than the pulse but fires slow enough that its sustained DPS is LOWER", () => {
    const pulse = weapon("wpn_pulse"); // dmg 14, cooldownTurns 1
    const beam = weapon("wpn_beam"); // dmg 30, cooldownTurns 3
    expect(beam.damage).toBeGreaterThan(pulse.damage); // bigger punch per shot
    expect(dps("wpn_beam")).toBeLessThan(dps("wpn_pulse")); // …but worse sustained DPS
  });

  it("sustained DPS follows damage ÷ cadence, not raw per-shot damage", () => {
    // Railgun (26 dmg, cooldownTurns 1) out-DPSes the heavier-hitting beam
    // (30 dmg, cooldownTurns 3): cadence, not raw damage, sets the ordering.
    expect(weapon("wpn_railgun").damage).toBeLessThan(
      weapon("wpn_beam").damage,
    );
    expect(dps("wpn_railgun")).toBeGreaterThan(dps("wpn_beam"));
  });
});

// ---------------------------------------------------------------------------
// Integration — the module fires each weapon on its own cadence
// ---------------------------------------------------------------------------
describe("CombatModule fires per-weapon cadence", () => {
  it("a cooldownTurns:3 weapon fires ~⅓ as often as a cooldownTurns:1 weapon over a fixed window", () => {
    const window = BASE * 12; // 12 quick intervals / 4 slow intervals
    const pulseShots = countShots("wpn_pulse", window); // cooldownTurns 1
    const beamShots = countShots("wpn_beam", window); // cooldownTurns 3
    // The quick weapon should fire roughly 3× as often as the slow one.
    expect(pulseShots).toBeGreaterThan(beamShots * 2.5);
    expect(pulseShots).toBeLessThan(beamShots * 3.5);
    // And both fire about as many times as their interval predicts.
    expect(pulseShots).toBeGreaterThanOrEqual(10); // ~12 expected
    expect(beamShots).toBeGreaterThanOrEqual(3); // ~4 expected
  });

  it("a cooldownTurns:1 weapon keeps the original flat cadence (one shot per base interval)", () => {
    const { module } = moduleWith("wpn_pulse");
    const target = makeSprite("t", 50, 0, 10_000); // in range, survives
    module.addCombatant(target);
    module.update(BASE - 1); // just shy of the interval — no shot yet
    expect(target.npc.hullHP).toBe(10_000);
    module.update(1); // crosses the base interval — exactly one pulse lands
    expect(target.npc.hullHP).toBe(10_000 - weapon("wpn_pulse").damage);
  });

  it("a slow weapon does NOT fire at the base interval — only at its own (3×) interval", () => {
    const { module } = moduleWith("wpn_beam"); // cooldownTurns 3 → 3× base
    const target = makeSprite("t", 50, 0, 10_000);
    module.addCombatant(target);
    module.update(BASE); // one base interval — too soon for the slow beam
    expect(target.npc.hullHP).toBe(10_000); // held fire
    module.update(BASE * 2); // now 3× base total → the beam fires once
    expect(target.npc.hullHP).toBe(10_000 - weapon("wpn_beam").damage);
  });

  it("a cooldownTurns:3 weapon's first shot after engaging lands well before the full cold-start interval (engage pre-charge)", () => {
    const beamInterval = weaponFireIntervalMs(weapon("wpn_beam")); // 7500 ms
    const budget = beamInterval * GAME_BALANCE.combatEngagePrechargeFraction; // target: no later than half the cold-start interval
    const { module } = moduleWith("wpn_beam");
    const target = makeSprite("t", 50, 0, 10_000);
    module.addCombatant(target);

    module.update(budget - 1); // just shy of the pre-charged budget — no shot yet
    expect(target.npc.hullHP).toBe(10_000);

    module.update(1); // crosses the budget — first shot lands, well short of the full 7500 ms
    expect(target.npc.hullHP).toBe(10_000 - weapon("wpn_beam").damage);
  });

  it("engage pre-charge does not change steady-state cadence — the second shot still waits the full interval", () => {
    const beamInterval = weaponFireIntervalMs(weapon("wpn_beam"));
    const budget = beamInterval * GAME_BALANCE.combatEngagePrechargeFraction;
    const { module } = moduleWith("wpn_beam");
    const target = makeSprite("t", 50, 0, 10_000_000);
    module.addCombatant(target);

    module.update(budget); // first (pre-charged) shot lands
    expect(target.npc.hullHP).toBe(10_000_000 - weapon("wpn_beam").damage);

    module.update(beamInterval - 1); // just shy of a full interval since the first shot
    expect(target.npc.hullHP).toBe(10_000_000 - weapon("wpn_beam").damage); // still one shot

    module.update(1); // crosses the full interval — second shot lands
    expect(target.npc.hullHP).toBe(10_000_000 - weapon("wpn_beam").damage * 2);
  });

  it("a cooldownTurns:1 weapon gets no engage pre-charge (its interval already equals one turn)", () => {
    const { module } = moduleWith("wpn_pulse");
    const target = makeSprite("t", 50, 0, 10_000);
    module.addCombatant(target);
    module.update(BASE - 1); // just shy of the interval — no shot yet, precharge would break this
    expect(target.npc.hullHP).toBe(10_000);
    module.update(1);
    expect(target.npc.hullHP).toBe(10_000 - weapon("wpn_pulse").damage);
  });
});
