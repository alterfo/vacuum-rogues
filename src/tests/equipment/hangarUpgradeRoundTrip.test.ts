import { describe, it, expect } from "vitest";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { slotToBagModule } from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import { ShipModuleSchema } from "@/validation/schemas";

describe("hangar unequip → re-fit preserves artifact upgrades", () => {
  it("slotToBagModule carries both micromodule and upgrade count off a slot", () => {
    const gear = gearById("wpn_pulse")!;
    const mod = slotToBagModule(gear, {
      micromoduleId: "mm_amplifier_1",
      upgrades: 2,
    });
    expect(mod.id).toBe("wpn_pulse");
    expect(mod.micromoduleId).toBe("mm_amplifier_1");
    expect(mod.upgrades).toBe(2);
  });

  it("does not invent upgrades for an un-upgraded slot", () => {
    const gear = gearById("wpn_pulse")!;
    const mod = slotToBagModule(gear, {});
    expect(mod.upgrades).toBeUndefined();
    expect(mod.micromoduleId).toBeUndefined();
  });

  it("preserves upgrades across unequip → bag → re-install", () => {
    const eq = new EquipmentSystem();
    const loadout = new ShipLoadout("hull_corvette");
    eq.installGear(loadout, "eq_radar");
    loadout.setSlotUpgrades(loadout.installedGearIds().length - 1, 2);
    const upgradedRange = loadout.derivedStats().radarRange;

    const slot = loadout.installedSlots()[0];
    expect(slot.upgrades).toBe(2);
    expect(loadout.removeAt(0)).toBe(true);
    const bagged = slotToBagModule(gearById(slot.gearId)!, slot);

    expect(eq.installGear(loadout, bagged.id)).toBe(true);
    const last = loadout.installedGearIds().length - 1;
    if (bagged.upgrades) loadout.setSlotUpgrades(last, bagged.upgrades);

    expect(loadout.installedSlots()[0].upgrades).toBe(2);
    const baseline = new ShipLoadout("hull_corvette");
    baseline.install("eq_radar");
    expect(upgradedRange).toBeGreaterThan(baseline.derivedStats().radarRange);
    expect(loadout.derivedStats().radarRange).toBe(upgradedRange);
  });

  it("persists the bagged item's upgrades through the save schema", () => {
    const parsed = ShipModuleSchema.parse({
      id: "wpn_pulse",
      category: "WEAPON",
      name: "Pulse",
      effect: { type: "weapon", value: 30 },
      level: 3,
      micromoduleId: "mm_amplifier_1",
      upgrades: 2,
    });
    expect(parsed.upgrades).toBe(2);
    expect(parsed.micromoduleId).toBe("mm_amplifier_1");
  });
});
