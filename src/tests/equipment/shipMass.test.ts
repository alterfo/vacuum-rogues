import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";

/**
 * Mass budget (SR-canon МАССА/СВОБОДНО, Ship Fitting Task 2): installed gear sums
 * against the hull's `massCapacity`; an install is rejected when it would push the
 * total over budget, **even if the category slot is free**. Mass is catalog data
 * keyed by gear id, so it needs no save migration.
 */
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
    // eq_engine_i is mass 6 → 24 + 6 = 30, exactly the budget: allowed.
    expect(lo.canInstall("eq_engine_i")).toBe(true);
    expect(lo.install("eq_engine_i")).toBe(true);
    expect(lo.derivedStats().massUsed).toBe(30);
    expect(lo.derivedStats().massFree).toBe(0);
  });

  it("rejects an install that exceeds the mass budget even when the slot is free", () => {
    const lo = new ShipLoadout("hull_scout"); // massCapacity 30
    lo.install("wpn_torpedo"); // 12
    lo.install("wpn_torpedo"); // 24 (weapon bank full)

    // The engine slot is empty, but eq_engine_iii (mass 8) → 24 + 8 = 32 > 30.
    expect(lo.canInstall("eq_engine_iii")).toBe(false);
    expect(lo.install("eq_engine_iii")).toBe(false);

    // Bring it exactly to the cap with a lighter engine (mass 6 → 30).
    expect(lo.install("eq_engine_i")).toBe(true);

    // At capacity: the equipment bank is wide open (0/2) yet even the lightest
    // item (eq_tank, mass 3) is blocked purely by mass.
    expect(lo.canInstall("eq_tank")).toBe(false);
    expect(lo.install("eq_tank")).toBe(false);
    expect(lo.derivedStats().massUsed).toBe(30);
  });

  it("frees the replaced single-slot fitting's mass when swapping engines", () => {
    // Load a warden (massCapacity 70) to within 4 of the cap with eq_engine_i.
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i"); // 6
    lo.install("wpn_torpedo"); // 18
    lo.install("wpn_torpedo"); // 30
    lo.install("wpn_torpedo"); // 42 (weapon bank 3/3)
    lo.install("eq_shield"); // 50
    lo.install("eq_shield"); // 58
    lo.install("eq_shield"); // 66
    expect(lo.derivedStats().massUsed).toBe(66);

    // Naively 66 + 8 = 74 > 70 would block, but the swap frees the old engine's
    // 6 mass first: 66 − 6 + 8 = 68 ≤ 70 → allowed.
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
    // No mass field is persisted: it lives on the catalog gear, keyed by id.
    expect(JSON.stringify(snapshot)).not.toContain("mass");
    expect(snapshot.slotted.every((s) => "gearId" in s)).toBe(true);

    const restored = ShipLoadout.fromJSON(snapshot)!;
    const expected =
      (gearById("eq_engine_i")?.mass ?? 0) + (gearById("wpn_pulse")?.mass ?? 0);
    expect(restored.derivedStats().massUsed).toBe(expected);
    expect(restored.derivedStats().massUsed).toBe(lo.derivedStats().massUsed);
  });
});
