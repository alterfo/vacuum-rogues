import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * Slot-precise loadout operations (dual-hull review fixes): the hangar must
 * operate on the exact clicked slot, and hull swaps must not destroy gear.
 */

/**
 * Fill a bastion in a valid SR-canon category mix totalling its 9 slots:
 * 4 weapons (the weapon-bank cap) + engine + radar + 3 additional-equipment
 * items. Weapons occupy slots 0-3, so a downsize that pops from the end drops
 * the engine/radar/equipment tail (slots 4-8) and keeps the weapons.
 */
function fillBastionMix(lo: ShipLoadout): void {
  for (let i = 0; i < 4; i++) lo.install("wpn_pulse");
  lo.install("eq_engine_i"); // slot 4
  lo.install("eq_radar"); // slot 5
  lo.install("eq_tank"); // slot 6
  lo.install("eq_scanner"); // slot 7
  lo.install("eq_droid"); // slot 8
}

describe("ShipLoadout.setHull — returns dropped gear ids", () => {
  it("returns the gear ids dropped when swapping to a smaller hull", () => {
    const loadout = new ShipLoadout("hull_bastion"); // 9 slots
    fillBastionMix(loadout);

    const dropped = loadout.setHull("hull_scout"); // 4 slots → drops 5

    expect(loadout.installedGearIds().length).toBe(4);
    expect(dropped).toHaveLength(5);
    // The 4 weapons (slots 0-3) survive; the engine/radar/equipment tail is
    // what a bastion-sized fitting drops when downsizing to the scout.
    expect([...dropped].sort()).toEqual(
      ["eq_droid", "eq_engine_i", "eq_radar", "eq_scanner", "eq_tank"].sort(),
    );
  });

  it("returns an empty array (and keeps gear) when nothing is dropped", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");

    expect(loadout.setHull("hull_bastion")).toEqual([]);
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse"]);
  });

  it("returns an empty array and keeps the hull for an invalid hull id", () => {
    const loadout = new ShipLoadout("hull_scout");

    expect(loadout.setHull("not_a_hull")).toEqual([]);
    expect(loadout.hull.id).toBe("hull_scout");
  });
});

describe("ShipLoadout.swapHull — re-bags dropped gear losslessly", () => {
  it("returns the dropped slot's micromodule and upgrade count, not just the id", () => {
    const loadout = new ShipLoadout("hull_bastion"); // 9 slots
    fillBastionMix(loadout);
    // Micro-mod + artifact-upgrade slot 8 (the last additional-equipment item,
    // eq_droid). It is among the slots dropped when downsizing to the 4-slot
    // scout (swapHull pops from the end), so its micromodule + upgrades must
    // survive in the returned record — else a hull downsize silently destroys
    // the resources spent on them.
    loadout.applyMicromoduleAt(8, "mm_amplifier_1");
    loadout.setSlotUpgrades(8, 2);

    const dropped = loadout.swapHull("hull_scout"); // 4 slots → drops 5

    expect(dropped).toHaveLength(5);
    const enriched = dropped.find((s) => s.micromoduleId === "mm_amplifier_1");
    expect(enriched).toBeDefined();
    expect(enriched?.gearId).toBe("eq_droid");
    expect(enriched?.upgrades).toBe(2);
  });

  it("setHull stays a thin id-projection over swapHull", () => {
    const loadout = new ShipLoadout("hull_bastion");
    fillBastionMix(loadout);

    // Dropped in pop order (last-installed first): the equipment tail, then
    // radar, then engine — the 4 weapons in slots 0-3 stay.
    expect(loadout.setHull("hull_scout")).toEqual([
      "eq_droid",
      "eq_scanner",
      "eq_tank",
      "eq_radar",
      "eq_engine_i",
    ]);
  });
});

describe("ShipLoadout.removeAt — removes the exact slot", () => {
  it("removes the clicked copy when two identical items are fitted", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse"); // slot 0 (bare)
    loadout.install("wpn_pulse"); // slot 1 (micro-modded below)
    loadout.applyMicromoduleAt(1, "mm_amplifier_1");
    expect(loadout.micromoduleAt(1)).toBe("mm_amplifier_1");

    // Removing slot 0 must leave the micro-modded copy intact — a by-id remove
    // would have dropped the first match (slot 0's twin) and could orphan the
    // micromodule.
    expect(loadout.removeAt(0)).toBe(true);
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse"]);
    expect(loadout.micromoduleAt(0)).toBe("mm_amplifier_1");
  });

  it("rejects an out-of-range index", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");

    expect(loadout.removeAt(5)).toBe(false);
    expect(loadout.removeAt(-1)).toBe(false);
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse"]);
  });
});

describe("ShipLoadout.applyMicromoduleAt — targets the exact slot", () => {
  it("applies to the indexed slot, not the first id-match", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse"); // slot 0
    loadout.install("wpn_pulse"); // slot 1

    expect(loadout.applyMicromoduleAt(1, "mm_amplifier_1")).toBe(true);
    expect(loadout.micromoduleAt(0)).toBeUndefined();
    expect(loadout.micromoduleAt(1)).toBe("mm_amplifier_1");
  });

  it("rejects a second micromodule on the same slot (one per item)", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");

    expect(loadout.applyMicromoduleAt(0, "mm_amplifier_1")).toBe(true);
    expect(loadout.applyMicromoduleAt(0, "mm_amplifier_2")).toBe(false);
    expect(loadout.micromoduleAt(0)).toBe("mm_amplifier_1");
  });

  it("rejects an out-of-range index", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");

    expect(loadout.applyMicromoduleAt(3, "mm_amplifier_1")).toBe(false);
  });
});
