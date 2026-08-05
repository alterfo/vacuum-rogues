import { describe, it, expect, vi, afterEach } from "vitest";
import { CombatSystem } from "@/systems/CombatSystem";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById, GearKind } from "@/systems/equipment/GearCatalog";
import { EnemyShip } from "@/domain/EnemyShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import type { EnemyType, AIProfile } from "@/types";

function makeEnemy(techLevel = 4): EnemyShip {
  return new EnemyShip(
    `enemy_${techLevel}`,
    "FIGHTER" as EnemyType,
    100,
    30,
    0.1,
    15,
    false,
    [],
    {} as AIProfile,
    techLevel,
  );
}

describe("EquipmentSystem.installLoot — feed combat loot into the loadout", () => {
  it("installs a looted weapon into a free loadout slot", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");
    const before = loadout.installedGearIds().length;

    const ok = eq.installLoot(loadout, "wpn_pulse");

    expect(ok).toBe(true);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    expect(loadout.installedGearIds().length).toBe(before + 1);
  });

  it("installs looted equipment into a free loadout slot", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installLoot(loadout, "eq_radar")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_radar");
  });

  it("rejects a hull id (hulls are not installable as loot)", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installLoot(loadout, "hull_scout")).toBe(false);
    expect(loadout.installedGearIds()).not.toContain("hull_scout");
  });

  it("rejects an unknown gear id", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");

    expect(eq.installLoot(loadout, "not_a_real_id")).toBe(false);
  });

  it("returns false (never replaces fitted gear) when the loadout is full", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");
    const slots = loadout.hull.slots;
    const fill = [
      "wpn_pulse",
      "wpn_pulse",
      "eq_engine_i",
      "eq_radar",
      "eq_tank",
    ];
    for (const id of fill) {
      expect(loadout.install(id)).toBe(true);
    }
    expect(loadout.installedGearIds().length).toBe(slots);

    expect(eq.installLoot(loadout, "wpn_railgun")).toBe(false);
    expect(loadout.installedGearIds().length).toBe(slots);
  });
});

describe("CombatSystem loot drop is installable via ShipLoadout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every resolveVictory loot drop resolves to installable catalog Gear", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // force a loot drop
    const system = new CombatSystem({} as AdaptiveQualityProfile);
    const eq = new EquipmentSystem();

    const result = system.resolveVictory([makeEnemy()]);

    expect(result.loot.length).toBeGreaterThan(0);
    for (const drop of result.loot) {
      const gear = gearById(drop.id);
      expect(gear).toBeDefined();
      expect(gear!.kind).not.toBe(GearKind.HULL);

      const loadout = new ShipLoadout("hull_corvette");
      expect(eq.installLoot(loadout, drop.id)).toBe(true);
      expect(loadout.installedGearIds()).toContain(drop.id);
    }
  });
});
