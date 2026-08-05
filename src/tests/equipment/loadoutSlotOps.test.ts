import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

function fillBastionMix(lo: ShipLoadout): void {
  for (let i = 0; i < 4; i++) lo.install("wpn_pulse");
  lo.install("eq_engine_i"); // slot 4
  lo.install("eq_radar"); // slot 5
  lo.install("eq_tank"); // slot 6
  lo.install("eq_scanner"); // slot 7
  lo.install("eq_droid"); // slot 8
}

describe("ShipLoadout.setHull — returns dropped gear ids", () => {
  it("drops per-category overflow, not a flat pop, when downsizing", () => {
    const loadout = new ShipLoadout("hull_bastion"); // weapons 4 / equip 5
    fillBastionMix(loadout);

    const dropped = loadout.setHull("hull_scout"); // weapons 2 / equip 2

    expect(loadout.installedGearIds().length).toBe(6);
    expect(dropped).toHaveLength(3);
    expect([...dropped].sort()).toEqual(
      ["eq_droid", "wpn_pulse", "wpn_pulse"].sort(),
    );
    const cats = loadout.derivedStats().categories;
    for (const c of Object.values(cats))
      expect(c.used).toBeLessThanOrEqual(c.total);
    expect(loadout.derivedStats().canTakeOff).toBe(true);
    expect(loadout.derivedStats().massUsed).toBeLessThanOrEqual(
      loadout.derivedStats().massCapacity,
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
    const loadout = new ShipLoadout("hull_bastion"); // weapons 4 / equip 5
    fillBastionMix(loadout);
    loadout.applyMicromoduleAt(8, "mm_amplifier_1");
    loadout.setSlotUpgrades(8, 2);

    const dropped = loadout.swapHull("hull_scout"); // drops 2 weapons + eq_droid

    expect(dropped).toHaveLength(3);
    const enriched = dropped.find((s) => s.micromoduleId === "mm_amplifier_1");
    expect(enriched).toBeDefined();
    expect(enriched?.gearId).toBe("eq_droid");
    expect(enriched?.upgrades).toBe(2);
  });

  it("setHull stays a thin id-projection over swapHull", () => {
    const loadout = new ShipLoadout("hull_bastion");
    fillBastionMix(loadout);

    expect(loadout.setHull("hull_scout")).toEqual([
      "wpn_pulse",
      "wpn_pulse",
      "eq_droid",
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
