import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById, type HullSpec } from "@/systems/equipment/GearCatalog";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import type { SaveState } from "@/domain/SaveState";

describe("ShipLoadout — multi-slot hull micromodules", () => {
  it("exposes the hull's micromodule-slot count", () => {
    expect(new ShipLoadout("hull_scout").hullMicromoduleSlots()).toBe(1);
    expect(new ShipLoadout("hull_corvette").hullMicromoduleSlots()).toBe(2);
    expect(new ShipLoadout("hull_courier").hullMicromoduleSlots()).toBe(2);
    expect(new ShipLoadout("hull_warden").hullMicromoduleSlots()).toBe(3);
    expect(new ShipLoadout("hull_freighter").hullMicromoduleSlots()).toBe(3);
    expect(new ShipLoadout("hull_bastion").hullMicromoduleSlots()).toBe(4);
  });

  it("every catalog hull declares 1–4 micromodule slots", () => {
    const hullIds = [
      "hull_scout",
      "hull_corvette",
      "hull_courier",
      "hull_warden",
      "hull_freighter",
      "hull_bastion",
    ];
    for (const id of hullIds) {
      const hull = gearById(id) as HullSpec;
      expect(hull.micromoduleSlots).toBeGreaterThanOrEqual(1);
      expect(hull.micromoduleSlots).toBeLessThanOrEqual(4);
    }
  });

  it("accepts up to micromoduleSlots hull micromodules and rejects beyond", () => {
    const scout = new ShipLoadout("hull_scout");
    expect(scout.applyMicromodule("hull_scout", "mm_amplifier_1")).toBe(true);
    expect(scout.applyMicromodule("hull_scout", "mm_amplifier_2")).toBe(false);
    expect(scout.hullMicromodules()).toEqual(["mm_amplifier_1"]);

    const bastion = new ShipLoadout("hull_bastion");
    expect(bastion.applyMicromodule("hull_bastion", "mm_amplifier_1")).toBe(
      true,
    );
    expect(bastion.applyMicromodule("hull_bastion", "mm_amplifier_2")).toBe(
      true,
    );
    expect(bastion.applyMicromodule("hull_bastion", "mm_amplifier_3")).toBe(
      true,
    );
    expect(bastion.applyMicromodule("hull_bastion", "mm_amplifier_1")).toBe(
      true,
    );
    expect(bastion.applyMicromodule("hull_bastion", "mm_amplifier_2")).toBe(
      false,
    );
    expect(bastion.hullMicromodules()).toEqual([
      "mm_amplifier_1",
      "mm_amplifier_2",
      "mm_amplifier_3",
      "mm_amplifier_1",
    ]);
  });

  it("rejects an unknown hull micromodule without consuming a slot", () => {
    const warden = new ShipLoadout("hull_warden");
    expect(warden.applyMicromodule("hull_warden", "mm_does_not_exist")).toBe(
      false,
    );
    expect(warden.hullMicromodules()).toEqual([]);
    expect(warden.applyMicromodule("hull_warden", "mm_amplifier_1")).toBe(true);
  });

  it("round-trips the hull micromodule array through toJSON/fromJSON", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    expect(lo.applyMicromodule("hull_warden", "mm_amplifier_1")).toBe(true);
    expect(lo.applyMicromodule("hull_warden", "mm_amplifier_2")).toBe(true);

    const snap = lo.toJSON();
    expect(snap.hullMicromoduleIds).toEqual([
      "mm_amplifier_1",
      "mm_amplifier_2",
    ]);

    const restored = ShipLoadout.fromJSON(snap);
    expect(restored).not.toBeNull();
    expect(restored!.hullMicromodules()).toEqual([
      "mm_amplifier_1",
      "mm_amplifier_2",
    ]);
    expect(restored!.derivedStats()).toEqual(lo.derivedStats());
  });

  it("reads a legacy single hullMicromoduleId snapshot into the array", () => {
    const restored = ShipLoadout.fromJSON({
      hullId: "hull_warden",
      hullMicromoduleId: "mm_amplifier_1",
      slotted: [],
    });
    expect(restored).not.toBeNull();
    expect(restored!.hullMicromodules()).toEqual(["mm_amplifier_1"]);
  });

  it("clears hull micromodules when the hull is swapped", () => {
    const lo = new ShipLoadout("hull_bastion");
    lo.applyMicromodule("hull_bastion", "mm_amplifier_1");
    expect(lo.hullMicromodules()).toEqual(["mm_amplifier_1"]);
    lo.setHull("hull_scout");
    expect(lo.hullMicromodules()).toEqual([]);
  });

  it("stacks hull micromodule multipliers onto maxHull (combined)", () => {
    const hp = (gearById("hull_bastion") as HullSpec).hp; // 360
    const lo = new ShipLoadout("hull_bastion");
    expect(lo.derivedStats().maxHull).toBe(hp);
    lo.applyMicromodule("hull_bastion", "mm_amplifier_1"); // +20%
    expect(lo.derivedStats().maxHull).toBe(Math.round(hp * 1.2));
    lo.applyMicromodule("hull_bastion", "mm_amplifier_1"); // ×1.2 again
    expect(lo.derivedStats().maxHull).toBe(Math.round(hp * 1.2 * 1.2));
  });
});

describe("MigrationPipeline v25→26 — hull micromodule array", () => {
  it("converts a legacy single hullMicromoduleId loadout into the array", () => {
    const raw = {
      version: 25,
      timestamp: 1,
      loadout: {
        hullId: "hull_warden",
        hullMicromoduleId: "mm_amplifier_1",
        slotted: [{ gearId: "eq_engine_i" }],
      },
    } as unknown as SaveState;

    const migrated = MigrationPipeline.migrate(raw) as unknown as {
      version: number;
      loadout: { hullMicromoduleId?: string; hullMicromoduleIds?: string[] };
    };

    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
    expect(migrated.loadout.hullMicromoduleIds).toEqual(["mm_amplifier_1"]);
    expect(migrated.loadout.hullMicromoduleId).toBeUndefined();

    const restored = ShipLoadout.fromJSON(
      migrated.loadout as Parameters<typeof ShipLoadout.fromJSON>[0],
    );
    expect(restored).not.toBeNull();
    expect(restored!.hullMicromodules()).toEqual(["mm_amplifier_1"]);
  });

  it("yields an empty array for a loadout with no hull micromodule", () => {
    const raw = {
      version: 25,
      timestamp: 1,
      loadout: { hullId: "hull_scout", slotted: [] },
    } as unknown as SaveState;

    const migrated = MigrationPipeline.migrate(raw) as unknown as {
      loadout: { hullMicromoduleIds?: string[] };
    };
    expect(migrated.loadout.hullMicromoduleIds).toEqual([]);
  });

  it("is a no-op when there is no loadout", () => {
    const raw = { version: 25, timestamp: 1 } as unknown as SaveState;
    expect(() => MigrationPipeline.migrate(raw)).not.toThrow();
  });
});
