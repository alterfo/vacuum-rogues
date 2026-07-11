import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  captureLoadoutPreset,
  upsertLoadoutPreset,
  removeLoadoutPreset,
  applyLoadoutPreset,
  installOwnedGear,
} from "@/systems/equipment/GearBridge";
import { LoadoutPresetSchema, SaveStateSchema } from "@/validation/schemas";
import { ModuleCategory, type LoadoutPreset } from "@/types";

/**
 * Task 6 (gear-variety-and-hangar): КОМПЛЕКТАЦИЯ 1/2/3 loadout presets.
 * `captureLoadoutPreset`/`applyLoadoutPreset` are pure over `Player`/
 * `ShipLoadout` — presets store gear ids (+ micromodule ids), never copies;
 * applying re-installs each slot from whatever is owned *now* through the
 * normal `ShipLoadout.install` path, so the engine's slot/mass rules are
 * never bypassed and a sold/missing item is skipped, not force-fitted.
 */

/** Minimal Player stand-in — the GearBridge helpers only touch `.inventory`. */
function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("captureLoadoutPreset", () => {
  it("snapshots fitted gear ids, per-slot micromodules and hull micromodules", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");
    loadout.applyMicromoduleAt(0, "mm_wpn_1");
    loadout.applyMicromodule("hull_corvette", "mm_hull_armor_1");

    const preset = captureLoadoutPreset("1", loadout);

    expect(preset.name).toBe("1");
    expect(preset.slots).toEqual([
      { gearId: "wpn_pulse", micromoduleId: "mm_wpn_1" },
      { gearId: "eq_engine_i", micromoduleId: undefined },
    ]);
    expect(preset.hullMicromoduleIds).toEqual(["mm_hull_armor_1"]);
  });

  it("captures an empty fitting as an empty slot list", () => {
    const loadout = new ShipLoadout("hull_scout");
    const preset = captureLoadoutPreset("2", loadout);
    expect(preset.slots).toEqual([]);
    expect(preset.hullMicromoduleIds).toEqual([]);
  });
});

describe("upsertLoadoutPreset / removeLoadoutPreset", () => {
  it("appends a new preset and preserves tab order when replacing", () => {
    const p1: LoadoutPreset = { name: "1", slots: [] };
    const p2: LoadoutPreset = { name: "2", slots: [] };
    let list = upsertLoadoutPreset([], p1);
    list = upsertLoadoutPreset(list, p2);
    expect(list.map((p) => p.name)).toEqual(["1", "2"]);

    const p1Updated: LoadoutPreset = {
      name: "1",
      slots: [{ gearId: "wpn_pulse" }],
    };
    list = upsertLoadoutPreset(list, p1Updated);
    expect(list.map((p) => p.name)).toEqual(["1", "2"]); // order unchanged
    expect(list[0]).toEqual(p1Updated); // content replaced
  });

  it("removeLoadoutPreset drops the named preset and is a no-op if absent", () => {
    const p1: LoadoutPreset = { name: "1", slots: [] };
    const p2: LoadoutPreset = { name: "2", slots: [] };
    const list = [p1, p2];
    expect(removeLoadoutPreset(list, "1")).toEqual([p2]);
    expect(removeLoadoutPreset(list, "3")).toEqual(list);
  });
});

describe("applyLoadoutPreset — round-trip", () => {
  it("re-fits a saved preset after swapping to a different loadout", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    inv.addOwnedGear("eq_tank");
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");

    const preset = captureLoadoutPreset("1", loadout);

    // Swap to a completely different fitting.
    installOwnedGear(player, loadout, "eq_radar");
    installOwnedGear(player, loadout, "eq_tank");
    expect(loadout.installedGearIds().sort()).toEqual(
      ["eq_engine_i", "eq_radar", "eq_tank", "wpn_pulse"].sort(),
    );

    const result = applyLoadoutPreset(player, loadout, preset);

    expect(result.applied.sort()).toEqual(["eq_engine_i", "wpn_pulse"].sort());
    expect(result.skipped).toEqual([]);
    expect(loadout.installedGearIds().sort()).toEqual(
      ["eq_engine_i", "wpn_pulse"].sort(),
    );
    // The gear the preset didn't need came back to the owned/bag stores, not
    // vanished — radar/tank should be recoverable somewhere in the inventory.
    const stillOwned =
      inv.ownedGearIds.includes("eq_radar") ||
      inv.modules.some((m) => m.id === "eq_radar");
    expect(stillOwned).toBe(true);
  });

  it("preserves a slot's micromodule across an unfit/re-apply round-trip", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    loadout.applyMicromoduleAt(0, "mm_wpn_1");

    const preset = captureLoadoutPreset("1", loadout);
    const result = applyLoadoutPreset(player, loadout, preset);

    expect(result.applied).toEqual(["wpn_pulse"]);
    const slot = loadout.installedSlots().find((s) => s.gearId === "wpn_pulse");
    expect(slot?.micromoduleId).toBe("mm_wpn_1");
  });

  it("skips a preset slot whose gear was sold, keeping the rest fitted", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");
    const preset = captureLoadoutPreset("1", loadout);

    // Sell the engine out of the bag entirely (unfit round-trip put it in
    // player.inventory.modules — drop it to simulate a sale before applying).
    applyLoadoutPreset(player, loadout, {
      name: "1",
      slots: [],
      hullMicromoduleIds: [],
    }); // fully strip the ship, bagging both items
    inv.modules = inv.modules.filter((m) => m.id !== "eq_engine_i");

    const result = applyLoadoutPreset(player, loadout, preset);

    expect(result.applied).toEqual(["wpn_pulse"]);
    expect(result.skipped).toEqual(["eq_engine_i"]);
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse"]);
  });

  it("restores a captured hull micromodule from an owned-but-uninstalled copy", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.applyMicromodule("hull_corvette", "mm_hull_armor_1");
    const preset = captureLoadoutPreset("1", loadout);

    // Swap hulls to lose the (unremovable) hull micromodule, then apply the
    // preset on the fresh hull, which still has a free hull-micromodule slot.
    // Restoring a destroyed hull micromodule must spend a fresh, owned,
    // uninstalled copy — it is a non-refundable purchase, never conjured.
    const fresh = new ShipLoadout("hull_corvette");
    expect(fresh.hullMicromodules()).toEqual([]);
    inv.micromodules.push({
      id: "mm_hull_armor_1",
      name: "Броневой набор ур.1",
      targetCategory: ModuleCategory.HULL,
      bonusType: "defense",
      bonusTier: 1,
    });

    const result = applyLoadoutPreset(player, fresh, preset);

    expect(fresh.hullMicromodules()).toEqual(["mm_hull_armor_1"]);
    expect(result.applied).toContain("mm_hull_armor_1");
    expect(inv.micromodules).toEqual([]);
  });

  it("skips restoring a destroyed hull micromodule when no owned copy remains (never free)", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.applyMicromodule("hull_corvette", "mm_hull_armor_1");
    const preset = captureLoadoutPreset("1", loadout);

    // Hull swap destroyed the micromodule and no fresh copy was bought back —
    // applying the preset on the new hull must NOT resurrect it for free.
    const fresh = new ShipLoadout("hull_corvette");

    const result = applyLoadoutPreset(player, fresh, preset);

    expect(fresh.hullMicromodules()).toEqual([]);
    expect(result.skipped).toContain("mm_hull_armor_1");
    expect(result.applied).not.toContain("mm_hull_armor_1");
  });

  it("does not re-apply (or spend inventory for) a hull micromodule already fitted on the live loadout", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_corvette");
    loadout.applyMicromodule("hull_corvette", "mm_hull_armor_1");
    const preset = captureLoadoutPreset("1", loadout);

    const result = applyLoadoutPreset(player, loadout, preset);

    expect(loadout.hullMicromodules()).toEqual(["mm_hull_armor_1"]);
    expect(result.applied).not.toContain("mm_hull_armor_1");
    expect(result.skipped).not.toContain("mm_hull_armor_1");
    expect(inv.micromodules).toEqual([]);
  });

  it("restores only as many copies of a duplicate hull-micromodule id as are owned", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_bastion"); // 2+ hull micromodule slots
    loadout.applyMicromodule(loadout.hull.id, "mm_hull_armor_1");
    loadout.applyMicromodule(loadout.hull.id, "mm_hull_armor_1");
    const preset = captureLoadoutPreset("1", loadout);
    expect(preset.hullMicromoduleIds).toEqual([
      "mm_hull_armor_1",
      "mm_hull_armor_1",
    ]);

    // Hull swap destroys both; only one replacement copy was bought back.
    const fresh = new ShipLoadout("hull_bastion");
    inv.micromodules.push({
      id: "mm_hull_armor_1",
      name: "Броневой набор ур.1",
      targetCategory: ModuleCategory.HULL,
      bonusType: "defense",
      bonusTier: 1,
    });

    const result = applyLoadoutPreset(player, fresh, preset);

    expect(fresh.hullMicromodules()).toEqual(["mm_hull_armor_1"]);
    expect(
      result.applied.filter((id) => id === "mm_hull_armor_1"),
    ).toHaveLength(1);
    expect(
      result.skipped.filter((id) => id === "mm_hull_armor_1"),
    ).toHaveLength(1);
    expect(inv.micromodules).toEqual([]);
  });

  it("never force-fits more copies than the current hull has slots for", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_courier"); // 1 weapon slot
    inv.addOwnedGear("wpn_pulse");
    inv.addOwnedGear("wpn_pulse");
    const preset: LoadoutPreset = {
      name: "1",
      slots: [{ gearId: "wpn_pulse" }, { gearId: "wpn_pulse" }],
    };

    const result = applyLoadoutPreset(player, loadout, preset);

    // Exactly one weapon slot exists — the second copy is skipped, not forced in.
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse"]);
    expect(result.applied).toEqual(["wpn_pulse"]);
    expect(result.skipped).toEqual(["wpn_pulse"]);
  });
});

describe("LoadoutPresetSchema / SaveStateSchema.loadoutPresets — round-trip", () => {
  it("validates a preset with slots + hull micromodules", () => {
    const parsed = LoadoutPresetSchema.parse({
      name: "1",
      slots: [{ gearId: "wpn_pulse", micromoduleId: "mm_wpn_1" }],
      hullMicromoduleIds: ["mm_hull_armor_1"],
    });
    expect(parsed.name).toBe("1");
    expect(parsed.slots).toHaveLength(1);
  });

  it("SaveStateSchema.loadoutPresets is optional (pre-Task-6 saves lack it)", () => {
    const field = SaveStateSchema.shape.loadoutPresets;
    expect(field.parse(undefined)).toBeUndefined();
    expect(
      field.parse([{ name: "1", slots: [{ gearId: "wpn_pulse" }] }]),
    ).toHaveLength(1);
  });

  it("caps at 3 presets", () => {
    const field = SaveStateSchema.shape.loadoutPresets;
    const four = (["1", "2", "3"] as const).map((name) => ({
      name,
      slots: [],
    }));
    expect(() => field.parse([...four, { name: "1", slots: [] }])).toThrow();
  });
});
