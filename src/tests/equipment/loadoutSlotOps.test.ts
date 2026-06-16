import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * Slot-precise loadout operations (dual-hull review fixes): the hangar must
 * operate on the exact clicked slot, and hull swaps must not destroy gear.
 */
describe("ShipLoadout.setHull — returns dropped gear ids", () => {
  it("returns the gear ids dropped when swapping to a smaller hull", () => {
    const loadout = new ShipLoadout("hull_bastion"); // 9 slots
    for (let i = 0; i < 9; i++) loadout.install("wpn_pulse");

    const dropped = loadout.setHull("hull_scout"); // 4 slots

    expect(loadout.installedGearIds().length).toBe(4);
    expect(dropped).toHaveLength(5);
    expect(dropped.every((id) => id === "wpn_pulse")).toBe(true);
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
