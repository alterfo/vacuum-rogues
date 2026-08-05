import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  ownedUninstalledGear,
  acquireUninstalledGear,
  installOwnedGear,
  uninstallToOwned,
  jettisonOwnedGear,
} from "@/systems/equipment/GearBridge";
import { InventorySchema } from "@/validation/schemas";

function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("Inventory.ownedGearIds store", () => {
  it("defaults to empty for a fresh inventory", () => {
    expect(new Inventory().ownedGearIds).toEqual([]);
  });

  it("addOwnedGear appends; removeOwnedGear drops the first copy", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    inv.addOwnedGear("wpn_pulse");
    inv.addOwnedGear("eq_radar");
    expect(inv.ownedGearIds).toEqual(["wpn_pulse", "wpn_pulse", "eq_radar"]);

    expect(inv.removeOwnedGear("wpn_pulse")).toBe(true);
    expect(inv.ownedGearIds).toEqual(["wpn_pulse", "eq_radar"]);
  });

  it("removeOwnedGear returns false when the id is not owned", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    expect(inv.removeOwnedGear("wpn_pulse")).toBe(false);
    expect(inv.ownedGearIds).toEqual(["eq_radar"]);
  });
});

describe("ownedUninstalledGear — owned minus installed", () => {
  it("returns the owned store when nothing is installed", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    inv.addOwnedGear("eq_radar");
    const loadout = new ShipLoadout("hull_corvette");

    expect(ownedUninstalledGear(playerWith(inv), loadout)).toEqual([
      "wpn_pulse",
      "eq_radar",
    ]);
  });

  it("keeps an owned spare visible even when a duplicate is fitted", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");

    expect(ownedUninstalledGear(playerWith(inv), loadout)).toEqual([
      "wpn_pulse",
    ]);
  });

  it("tolerates a missing loadout (owned store is the full list)", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    expect(ownedUninstalledGear(playerWith(inv), null)).toEqual(["eq_radar"]);
  });
});

describe("acquire / install / uninstall transitions", () => {
  it("acquireUninstalledGear lands a non-installed purchase in the store", () => {
    const inv = new Inventory();
    acquireUninstalledGear(playerWith(inv), "wpn_pulse");
    expect(inv.ownedGearIds).toEqual(["wpn_pulse"]);
  });

  it("installOwnedGear moves an id from the store into the loadout", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    expect(installOwnedGear(player, loadout, "eq_radar")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_radar");
    expect(inv.ownedGearIds).toEqual([]);
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
  });

  it("installOwnedGear returns the displaced engine to the store (swap, no loss)", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_engine_iii");
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");
    const player = playerWith(inv);

    expect(installOwnedGear(player, loadout, "eq_engine_iii")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_engine_iii");
    expect(loadout.installedGearIds()).not.toContain("eq_engine_i");
    expect(inv.ownedGearIds).toEqual(["eq_engine_i"]);
  });

  it("installOwnedGear rejects a hull and leaves the store untouched", () => {
    const inv = new Inventory();
    inv.addOwnedGear("hull_scout");
    const loadout = new ShipLoadout("hull_corvette");

    expect(installOwnedGear(playerWith(inv), loadout, "hull_scout")).toBe(
      false,
    );
    expect(inv.ownedGearIds).toEqual(["hull_scout"]);
    expect(loadout.installedGearIds()).not.toContain("hull_scout");
  });

  it("installOwnedGear fails (no move) when every slot is full", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_railgun");
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");
    loadout.install("eq_radar");
    loadout.install("eq_tank");
    loadout.install("eq_scanner");
    loadout.install("eq_droid");

    expect(installOwnedGear(playerWith(inv), loadout, "wpn_railgun")).toBe(
      false,
    );
    expect(inv.ownedGearIds).toEqual(["wpn_railgun"]);
  });

  it("uninstallToOwned moves a fitted slot back into the store", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_radar");
    const player = playerWith(inv);

    expect(uninstallToOwned(player, loadout, 0)).toBe(true);
    expect(loadout.installedGearIds()).not.toContain("eq_radar");
    expect(inv.ownedGearIds).toEqual(["eq_radar"]);
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_radar"]);
  });

  it("uninstallToOwned returns false for an out-of-range slot", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_radar");

    expect(uninstallToOwned(playerWith(inv), loadout, 5)).toBe(false);
    expect(inv.ownedGearIds).toEqual([]);
    expect(loadout.installedGearIds()).toContain("eq_radar");
  });

  it("full round-trip: acquire → install → uninstall returns to the store", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    acquireUninstalledGear(player, "eq_radar");
    expect(installOwnedGear(player, loadout, "eq_radar")).toBe(true);
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);

    const slot = loadout.installedGearIds().indexOf("eq_radar");
    expect(uninstallToOwned(player, loadout, slot)).toBe(true);
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_radar"]);
  });
});

describe("InventorySchema persists ownedGearIds", () => {
  it("defaults to [] when the field is absent (old saves)", () => {
    const parsed = InventorySchema.parse({
      modules: [],
      micromodules: [],
      resources: [],
      cosmetics: [],
    });
    expect(parsed.ownedGearIds).toEqual([]);
  });

  it("round-trips owned gear ids", () => {
    const parsed = InventorySchema.parse({
      modules: [],
      micromodules: [],
      resources: [],
      cosmetics: [],
      ownedGearIds: ["wpn_pulse", "eq_radar"],
    });
    expect(parsed.ownedGearIds).toEqual(["wpn_pulse", "eq_radar"]);
  });
});

describe("jettisonOwnedGear — drop an owned item with no refund (Bug 2)", () => {
  it("drops the first owned copy from the store", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    const player = playerWith(inv);

    expect(jettisonOwnedGear(player, "wpn_pulse")).toBe(true);
    expect(inv.ownedGearIds).toEqual([]);
  });

  it("returns false and changes nothing for an id not in the owned store", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    const player = playerWith(inv);

    expect(jettisonOwnedGear(player, "wpn_pulse")).toBe(false);
    expect(inv.ownedGearIds).toEqual(["eq_radar"]);
  });

  it("never touches installed loadout slots — only the owned store", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse"); // a spare, also fitted
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    const player = playerWith(inv);

    expect(jettisonOwnedGear(player, "wpn_pulse")).toBe(true);
    expect(inv.ownedGearIds).toEqual([]);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
  });
});
