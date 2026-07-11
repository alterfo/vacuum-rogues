import { describe, it, expect } from "vitest";
import {
  NpcSimulator,
  ROLE_STATS,
  ROLE_LOADOUT,
  npcRoleTechLevel,
} from "@/systems/npc/NpcSimulator";
import { NPC_WEAPON_RANGE } from "@/systems/combat/npcWeapon";
import { factionKindOf } from "@/systems/npc/factionHostility";
import { NpcShipSchema } from "@/validation/schemas";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";

/**
 * Task 1 of 20260709-overmind-ship-identity-and-balance: Overmind ships carry
 * their own `NpcRole.OVERMIND` (not a borrowed PATROL role) with distinct base
 * stats, and every exhaustive per-role map has an entry for it.
 */
describe("NpcRole.OVERMIND — distinct Overmind ship identity", () => {
  it("spawnOvermindInSystem produces role OVERMIND, not PATROL", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_role"),
      "ov_1",
      "sys_a",
    );
    expect(ship.role).toBe(NpcRole.OVERMIND);
    expect(ship.faction).toBe(Faction.OVERMIND);
    expect(ship.hostile).toBe(true);
  });

  it("OVERMIND base stats are distinct from (tougher than) PATROL", () => {
    const overmind = ROLE_STATS[NpcRole.OVERMIND];
    const patrol = ROLE_STATS[NpcRole.PATROL];
    expect(overmind).toBeDefined();
    expect(overmind).not.toEqual(patrol);
    // A hostile-faction hull reads tougher than the law's patrol ship. Damage
    // intentionally matches PATROL for now — the seeded letsplay campaign
    // gates stall on any garrison +damage (see the ROLE_STATS comment) — so
    // toughness comes from hull/shields/shield tech.
    expect(overmind.hull).toBeGreaterThan(patrol.hull);
    expect(overmind.shields).toBeGreaterThan(patrol.shields);
    expect(overmind.shieldPower).toBeGreaterThan(patrol.shieldPower);
    expect(overmind.damage).toBeGreaterThanOrEqual(patrol.damage);
    // But the base tier stays well under the boss override's 450-hull ceiling.
    expect(overmind.hull).toBeLessThan(450);
  });

  it("a spawned Overmind ship carries the OVERMIND stats, not PATROL's", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_stats"),
      "ov_2",
      "sys_a",
    );
    const stats = ROLE_STATS[NpcRole.OVERMIND];
    expect(ship.maxHull).toBe(stats.hull);
    expect(ship.hullHP).toBe(stats.hull);
    expect(ship.shields).toBe(stats.shields);
    expect(ship.damage).toBe(stats.damage);
    expect(ship.shieldPower).toBe(stats.shieldPower);
    expect(ship.loadoutSummary).toEqual(ROLE_LOADOUT[NpcRole.OVERMIND]);
  });

  it("every exhaustive per-role map has an entry for every NpcRole (drift guard)", () => {
    for (const role of Object.values(NpcRole)) {
      expect(ROLE_STATS[role], `ROLE_STATS missing ${role}`).toBeDefined();
      expect(ROLE_LOADOUT[role], `ROLE_LOADOUT missing ${role}`).toBeDefined();
      expect(
        NPC_WEAPON_RANGE[role],
        `NPC_WEAPON_RANGE missing ${role}`,
      ).toBeGreaterThan(0);
      expect(
        npcRoleTechLevel(role),
        `npcRoleTechLevel missing ${role}`,
      ).toBeGreaterThan(0);
    }
  });

  it("factionKindOf classifies an OVERMIND-role ship as 'overmind'", () => {
    expect(
      factionKindOf({ role: NpcRole.OVERMIND, faction: Faction.OVERMIND }),
    ).toBe("overmind");
  });

  it("spawned Overmind ships are named «Жнец N», not «Доминатор N» (Task 3 rename)", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_name"),
      "ov_42",
      "sys_a",
    );
    expect(ship.name).toBe("Жнец ov_42");
    expect(ship.name).not.toContain("Доминатор");
  });

  it("a persisted role 'OVERMIND' ship round-trips through NpcShipSchema", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_persist"),
      "ov_3",
      "sys_a",
    );
    const raw = JSON.parse(JSON.stringify(ship)) as unknown;
    const parsed = NpcShipSchema.parse(raw);
    expect(parsed.role).toBe("OVERMIND");
    expect(parsed.faction).toBe("OVERMIND");
    expect(parsed.maxHull).toBe(ship.maxHull);
  });
});
