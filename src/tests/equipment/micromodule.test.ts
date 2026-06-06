import { describe, it, expect } from "vitest";
import {
  MICRO_MODULES,
  microModuleById,
} from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { Inventory } from "@/domain/Inventory";
import { ShipModule } from "@/domain/ShipModule";
import { ModuleCategory } from "@/types";

describe("MICRO_MODULES catalog (Task 7)", () => {
  it("contains exactly 12 micromodule definitions", () => {
    expect(MICRO_MODULES).toHaveLength(12);
  });

  it("covers 4 categories: ENGINE, WEAPON, SHIELD, EQUIPMENT", () => {
    const categories = new Set(MICRO_MODULES.map((m) => m.targetCategory));
    expect(categories).toContain(ModuleCategory.ENGINE);
    expect(categories).toContain(ModuleCategory.WEAPON);
    expect(categories).toContain(ModuleCategory.SHIELD);
    expect(categories).toContain(ModuleCategory.EQUIPMENT);
    expect(categories.size).toBe(4);
  });

  it("has 3 tiers per category", () => {
    const byCategory = new Map<string, Set<number>>();
    for (const mm of MICRO_MODULES) {
      if (!byCategory.has(mm.targetCategory)) {
        byCategory.set(mm.targetCategory, new Set());
      }
      byCategory.get(mm.targetCategory)!.add(mm.bonusTier);
    }
    for (const [, tiers] of byCategory) {
      expect(tiers).toContain(1);
      expect(tiers).toContain(2);
      expect(tiers).toContain(3);
    }
  });

  it("all micromodules have unique ids", () => {
    const ids = MICRO_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("microModuleById returns the correct entry", () => {
    const mm = microModuleById("mm_eng_1");
    expect(mm).toBeDefined();
    expect(mm!.targetCategory).toBe(ModuleCategory.ENGINE);
    expect(mm!.bonusTier).toBe(1);
    expect(mm!.bonusType).toBe("speed");
  });

  it("microModuleById returns undefined for unknown id", () => {
    expect(microModuleById("nonexistent")).toBeUndefined();
  });
});

describe("Inventory micromodules (Task 7)", () => {
  it("initializes with an empty micromodules array", () => {
    const inv = new Inventory();
    expect(inv.micromodules).toEqual([]);
  });

  it("can store and retrieve micromodules", () => {
    const inv = new Inventory();
    const mm = microModuleById("mm_wpn_2")!;
    inv.micromodules.push(mm);
    expect(inv.micromodules).toHaveLength(1);
    expect(inv.micromodules[0].id).toBe("mm_wpn_2");
  });
});

describe("ShipModule micromoduleId (Task 7)", () => {
  it("starts with no micromodule applied", () => {
    const mod = new ShipModule(
      "eq_engine_i",
      ModuleCategory.ENGINE,
      "Двигатель Тип-I",
      { type: "engine", value: 20 },
      2,
    );
    expect(mod.micromoduleId).toBeUndefined();
  });

  it("can have a micromodule assigned once", () => {
    const mod = new ShipModule(
      "eq_shield",
      ModuleCategory.SHIELD,
      "Генератор поля",
      { type: "shield", value: 60 },
      6,
    );
    mod.micromoduleId = "mm_shld_1";
    expect(mod.micromoduleId).toBe("mm_shld_1");
  });
});

describe("ShipLoadout.applyMicromodule — rejection (Task 7)", () => {
  it("rejects a second micromodule on the same gear", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("wpn_beam");
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_2")).toBe(true);
    expect(lo.applyMicromodule("wpn_beam", "mm_amplifier_1")).toBe(false);
  });

  it("derive() adds tier-1 bonus (+20%) to the boosted stat", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i"); // tech 2 → base 0.11
    lo.install("eq_tank");
    const base = lo.derivedStats().speed;
    lo.applyMicromodule("eq_engine_i", "mm_amplifier_1");
    expect(lo.derivedStats().speed).toBeCloseTo(base * 1.2, 3);
  });
});
