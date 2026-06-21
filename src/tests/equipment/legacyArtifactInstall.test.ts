import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { WeaponModule, ShieldModule, EngineModule } from "@/domain/ShipModule";
import {
  legacyModuleToGearId,
  convertLegacyBagToOwnedGear,
  ownedUninstalledGear,
  installOwnedGear,
} from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { InventorySchema } from "@/validation/schemas";
import type { SaveState } from "@/domain/SaveState";

/**
 * Task 2 (Equipment overhaul): the dual-hull unification left pre-loadout
 * ShipModules in the legacy `inventory.modules` bag whose ids are NOT catalog
 * gear ids — the new-game starter trio "Лазер МК-1" / "Базовый щит" / "Быстрый
 * двигатель" (weapon_laser_1 / shield_basic_1 / engine_fast_1). With no
 * `gearById` match the hangar never offered an install button and they sat
 * stranded in the hold. These tests pin the conversion (legacyModuleToGearId /
 * convertLegacyBagToOwnedGear) and the one-time save migration (v24→v25) that
 * turn them into installable owned gear.
 */

/** Minimal Player stand-in — the equipment seams only touch `.inventory`. */
function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("legacyModuleToGearId — map a bag artifact to catalog gear", () => {
  it("maps the named starter trio to installable catalog gear", () => {
    expect(legacyModuleToGearId({ id: "weapon_laser_1" })).toBe("wpn_pulse");
    expect(legacyModuleToGearId({ id: "shield_basic_1" })).toBe("eq_shield");
    expect(legacyModuleToGearId({ id: "engine_fast_1" })).toBe("eq_engine_i");
    // The mapped ids are real, installable catalog gear (not hulls).
    for (const id of ["wpn_pulse", "eq_shield", "eq_engine_i"]) {
      expect(gearById(id)).toBeDefined();
    }
  });

  it("falls back to a catalog item of the module's category for unknown ids", () => {
    expect(
      legacyModuleToGearId({ id: "some_old_gun", category: "WEAPON" }),
    ).toBe("wpn_pulse");
    expect(
      legacyModuleToGearId({ id: "some_old_engine", category: "ENGINE" }),
    ).toBe("eq_engine_i");
  });

  it("leaves a catalog-id spare untouched (already installable) and unmappable ids alone", () => {
    // A real catalog id in the bag is a legit spare, not a stranded artifact.
    expect(
      legacyModuleToGearId({ id: "wpn_railgun", category: "WEAPON" }),
    ).toBeUndefined();
    // No explicit map entry and no usable category → no conversion.
    expect(legacyModuleToGearId({ id: "mystery_widget" })).toBeUndefined();
  });
});

describe("convertLegacyBagToOwnedGear — drain stranded artifacts into owned gear", () => {
  it("moves the starter trio into ownedGearIds and out of the bag", () => {
    const inv = new Inventory();
    inv.addItem(
      new WeaponModule(
        "weapon_laser_1",
        "Лазер МК-1",
        { type: "damage", value: 10 },
        1,
        15,
        3,
        10,
      ),
    );
    inv.addItem(
      new ShieldModule(
        "shield_basic_1",
        "Базовый щит",
        { type: "shield", value: 20 },
        1,
        25,
        5,
      ),
    );
    inv.addItem(
      new EngineModule(
        "engine_fast_1",
        "Быстрый двигатель",
        { type: "speed", value: 0.2 },
        1,
        0.3,
        0.1,
      ),
    );
    const player = playerWith(inv);

    expect(convertLegacyBagToOwnedGear(player)).toBe(3);
    expect(inv.modules).toEqual([]);
    expect([...inv.ownedGearIds].sort()).toEqual(
      ["eq_engine_i", "eq_shield", "wpn_pulse"].sort(),
    );
  });

  it("a converted legacy artifact installs onto a compatible hull", () => {
    const inv = new Inventory();
    inv.addItem(
      new WeaponModule(
        "weapon_laser_1",
        "Лазер МК-1",
        { type: "damage", value: 10 },
        1,
        15,
        3,
        10,
      ),
    );
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    convertLegacyBagToOwnedGear(player);
    expect(ownedUninstalledGear(player, loadout)).toEqual(["wpn_pulse"]);

    // The stranded artifact is now installable owned gear (the bug: it never was).
    expect(installOwnedGear(player, loadout, "wpn_pulse")).toBe(true);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
  });

  it("keeps catalog-id spares in the bag and is idempotent", () => {
    const inv = new Inventory();
    // A legit catalog-id spare (already installable via the legacy path) stays put.
    inv.addItem(
      new WeaponModule(
        "wpn_railgun",
        "Рельсотрон",
        { type: "damage", value: 26 },
        4,
        26,
        360,
        14,
      ),
    );
    inv.addItem(
      new EngineModule(
        "engine_fast_1",
        "Быстрый двигатель",
        { type: "speed", value: 0.2 },
        1,
        0.3,
        0.1,
      ),
    );
    const player = playerWith(inv);

    expect(convertLegacyBagToOwnedGear(player)).toBe(1);
    expect(inv.modules.map((m) => m.id)).toEqual(["wpn_railgun"]);
    expect(inv.ownedGearIds).toEqual(["eq_engine_i"]);
    // Re-run drains nothing more.
    expect(convertLegacyBagToOwnedGear(player)).toBe(0);
    expect(inv.modules.map((m) => m.id)).toEqual(["wpn_railgun"]);
  });
});

/** A legacy bag module as it appears in an un-rehydrated v24 save (plain JSON). */
function bagModule(id: string, category: string): Record<string, unknown> {
  return {
    id,
    category,
    name: id,
    effect: { type: category.toLowerCase(), value: 10 },
    level: 1,
  };
}

/** A minimal v24 save so only the v24→v25 step runs. */
function makeV24Save(
  modules: Array<Record<string, unknown>>,
  ownedGearIds?: string[],
): Record<string, unknown> {
  return {
    version: 24,
    timestamp: 1_000_000,
    persistentDialogs: [],
    galaxy: { id: "g", systems: [], npcShips: [] },
    player: {
      id: "p1",
      inventory: {
        modules,
        micromodules: [],
        resources: [],
        cosmetics: [],
        ...(ownedGearIds ? { ownedGearIds } : {}),
      },
    },
  };
}

function migratedInventory(raw: Record<string, unknown>): {
  modules: Array<{ id: string }>;
  ownedGearIds: string[];
} {
  const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
  return (
    migrated as unknown as {
      player: {
        inventory: { modules: Array<{ id: string }>; ownedGearIds: string[] };
      };
    }
  ).player.inventory;
}

describe("MigrationPipeline v24→v25 — legacy bag → installable owned gear", () => {
  it("converts the stranded starter trio into ownedGearIds and drains the bag", () => {
    const raw = makeV24Save([
      bagModule("weapon_laser_1", "WEAPON"),
      bagModule("shield_basic_1", "SHIELD"),
      bagModule("engine_fast_1", "ENGINE"),
    ]);
    const inv = migratedInventory(raw);

    expect(inv.modules).toEqual([]);
    expect([...inv.ownedGearIds].sort()).toEqual(
      ["eq_engine_i", "eq_shield", "wpn_pulse"].sort(),
    );
  });

  it("preserves catalog-id spares in the bag and appends to existing owned gear", () => {
    const raw = makeV24Save(
      [
        bagModule("wpn_railgun", "WEAPON"),
        bagModule("weapon_laser_1", "WEAPON"),
      ],
      ["eq_scanner"],
    );
    const inv = migratedInventory(raw);

    expect(inv.modules.map((m) => m.id)).toEqual(["wpn_railgun"]);
    expect(inv.ownedGearIds).toEqual(["eq_scanner", "wpn_pulse"]);
  });

  it("produces an inventory shape that still validates against the schema", () => {
    const raw = makeV24Save([bagModule("weapon_laser_1", "WEAPON")]);
    const inv = migratedInventory(raw);
    expect(() => InventorySchema.parse(inv)).not.toThrow();
  });

  it("is a no-op on a save with no player/inventory", () => {
    const migrated = MigrationPipeline.migrate({
      version: 24,
    } as unknown as SaveState);
    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
  });
});
