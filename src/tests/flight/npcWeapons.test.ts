import { describe, it, expect } from "vitest";
import { CombatModule } from "@/presentation/flight/CombatModule";
import { npcWeaponRange, NPC_WEAPON_RANGE } from "@/systems/combat/npcWeapon";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import {
  GEAR_CATALOG,
  GearKind,
  isRareGear,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import { GAME_BALANCE } from "@/config/balance";
import { NpcRole } from "@/types";

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const NPC_DMG = 20;

/** Player ship parked at the origin; combat measures distance from here. */
function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: false,
    currentSpeed: 0,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics;
}

/** NpcShipSprite stand-in carrying the role the weapon range derives from. */
function makeSprite(
  id: string,
  x: number,
  role: NpcRole,
  damage = NPC_DMG,
): NpcShipSprite {
  return {
    x,
    y: 0,
    npc: {
      id,
      name: id,
      hullHP: 10_000_000,
      maxHull: 10_000_000,
      role,
      damage,
    },
  } as unknown as NpcShipSprite;
}

/**
 * A CombatModule whose player ship is parked at the origin with a short-range
 * starter weapon (pulse, 240) so the player can't out-shoot a long-range NPC
 * placed past 240 — isolating the NPC's own firing range. Returns the live ship
 * so a test can read incoming hull loss.
 */
function arena(): {
  module: CombatModule;
  ship: { hullHP: number; maxHull: number };
} {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // range 240 — can't reach an NPC past 240
  const ship = { hullHP: 100_000, maxHull: 100_000 }; // tanky: never dies
  const module = new CombatModule({
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
  });
  return { module, ship };
}

// ---------------------------------------------------------------------------
// npcWeaponRange — per-role variety, no flat 240
// ---------------------------------------------------------------------------
describe("npcWeaponRange (per-role NPC weapon reach)", () => {
  it("differs across roles — enemies are not all the same flat range", () => {
    const ranges = [
      npcWeaponRange({ role: NpcRole.TRADER }),
      npcWeaponRange({ role: NpcRole.PIRATE }),
      npcWeaponRange({ role: NpcRole.RANGER }),
      npcWeaponRange({ role: NpcRole.PATROL }),
    ];
    // Four distinct values — no two roles share a reach.
    expect(new Set(ranges).size).toBe(4);
    // …and they are role-ordered: a trader's popgun < the law's long reach.
    expect(npcWeaponRange({ role: NpcRole.TRADER })).toBeLessThan(
      npcWeaponRange({ role: NpcRole.PATROL }),
    );
  });

  it("falls back to the legacy flat weaponRange for an absent/unknown role", () => {
    // A lightweight stand-in (no role) keeps the old behaviour so existing
    // combat tests stay green.
    expect(npcWeaponRange({})).toBe(GAME_BALANCE.weaponRange);
    expect(npcWeaponRange({ role: undefined })).toBe(GAME_BALANCE.weaponRange);
  });

  it("the longest enemy reach exceeds the old universal flat 240 (closes the gap)", () => {
    const maxNpc = Math.max(...Object.values(NPC_WEAPON_RANGE));
    expect(maxNpc).toBeGreaterThan(GAME_BALANCE.weaponRange);
  });
});

// ---------------------------------------------------------------------------
// The player's range edge is bounded, not infinite
// ---------------------------------------------------------------------------
describe("player range edge is bounded, not infinite", () => {
  const commonPlayerRanges = GEAR_CATALOG.filter(
    (g): g is WeaponSpec => g.kind === GearKind.WEAPON && !isRareGear(g),
  ).map((w) => w.range);
  const bestCommonPlayerRange = Math.max(...commonPlayerRanges);
  const maxNpcRange = Math.max(...Object.values(NPC_WEAPON_RANGE));

  it("the best common player weapon still out-ranges every enemy — but only just", () => {
    // The player keeps an edge (spending up on a long-range weapon matters)…
    expect(bestCommonPlayerRange).toBeGreaterThan(maxNpcRange);
    // …but the edge is bounded: the toughest enemy can return fire from nearly
    // the player's best reach, so one long weapon no longer trivialises combat.
    expect(bestCommonPlayerRange - maxNpcRange).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Integration — an NPC fires at ITS OWN range, not a flat 240
// ---------------------------------------------------------------------------
describe("CombatModule: an NPC engages at its own weapon range", () => {
  it("a long-range PATROL (340) returns fire from 300 — where the old flat 240 could not", () => {
    const { module, ship } = arena();
    const patrol = makeSprite("p", 300, NpcRole.PATROL); // 240 < 300 < 340
    module.addCombatant(patrol);
    module.update(FIRE);
    // It fired: the player took exactly one NPC shot. Under the old flat-240 gate
    // a foe at 300 was silently out-ranged and could not return fire.
    expect(ship.hullHP).toBe(100_000 - NPC_DMG);
  });

  it("a short-range TRADER (200) at 300 holds fire — beyond its own reach", () => {
    const { module, ship } = arena();
    const trader = makeSprite("t", 300, NpcRole.TRADER); // 300 > 200
    module.addCombatant(trader);
    module.update(FIRE);
    expect(ship.hullHP).toBe(100_000); // out of its range → no shot
  });

  it("the same PATROL drops out of fire past its own 340 reach (uses its range, not infinite)", () => {
    const { module, ship } = arena();
    const patrol = makeSprite("p", 360, NpcRole.PATROL); // 360 > 340
    module.addCombatant(patrol);
    module.update(FIRE);
    expect(ship.hullHP).toBe(100_000); // beyond its own range → no shot
  });
});
