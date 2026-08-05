import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";

describe("ShipLoadout — mass budget", () => {
  it("reports massUsed / massCapacity / massFree from the hull and installed gear", () => {
    const lo = new ShipLoadout("hull_scout"); // massCapacity 30
    lo.install("wpn_pulse"); // mass 4
    lo.install("eq_engine_i"); // mass 6
    lo.install("eq_tank"); // mass 3

    const s = lo.derivedStats();
    expect(s.massCapacity).toBe(30);
    expect(s.massUsed).toBe(13); // 4 + 6 + 3
    expect(s.massFree).toBe(17); // 30 − 13
  });

  it("allows installing right up to the mass capacity", () => {
    const lo = new ShipLoadout("hull_scout"); // massCapacity 30
    lo.install("wpn_torpedo"); // 12 → 12 (weapon bank 1/2)
    lo.install("wpn_torpedo"); // 12 → 24 (weapon bank 2/2)
    expect(lo.canInstall("eq_engine_i")).toBe(true);
    expect(lo.install("eq_engine_i")).toBe(true);
    expect(lo.derivedStats().massUsed).toBe(30);
    expect(lo.derivedStats().massFree).toBe(0);
  });

  it("rejects an install that exceeds the mass budget even when the slot is free", () => {
    const lo = new ShipLoadout("hull_scout"); // massCapacity 30
    lo.install("wpn_torpedo"); // 12
    lo.install("wpn_torpedo"); // 24 (weapon bank full)

    expect(lo.canInstall("eq_engine_iii")).toBe(false);
    expect(lo.install("eq_engine_iii")).toBe(false);

    expect(lo.install("eq_engine_i")).toBe(true);

    expect(lo.canInstall("eq_tank")).toBe(false);
    expect(lo.install("eq_tank")).toBe(false);
    expect(lo.derivedStats().massUsed).toBe(30);
  });

  it("frees the replaced single-slot fitting's mass when swapping engines", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i"); // 6
    lo.install("wpn_torpedo"); // 18
    lo.install("wpn_torpedo"); // 30
    lo.install("wpn_torpedo"); // 42 (weapon bank 3/3)
    lo.install("eq_shield"); // 50
    lo.install("eq_shield"); // 58
    lo.install("eq_shield"); // 66
    expect(lo.derivedStats().massUsed).toBe(66);

    expect(lo.canInstall("eq_engine_iii")).toBe(true);
    expect(lo.install("eq_engine_iii")).toBe(true);
    expect(
      lo.installedGearIds().filter((id) => id.startsWith("eq_engine")),
    ).toEqual(["eq_engine_iii"]);
    expect(lo.derivedStats().massUsed).toBe(68);
  });

  it("derives mass from the catalog — the snapshot stores ids only (no migration)", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    lo.install("wpn_pulse");

    const snapshot = lo.toJSON();
    expect(JSON.stringify(snapshot)).not.toContain("mass");
    expect(snapshot.slotted.every((s) => "gearId" in s)).toBe(true);

    const restored = ShipLoadout.fromJSON(snapshot)!;
    const expected =
      (gearById("eq_engine_i")?.mass ?? 0) + (gearById("wpn_pulse")?.mass ?? 0);
    expect(restored.derivedStats().massUsed).toBe(expected);
    expect(restored.derivedStats().massUsed).toBe(lo.derivedStats().massUsed);
  });
});
