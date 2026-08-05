import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  ownedUninstalledGear,
  acquireUninstalledGear,
  installOwnedGear,
  uninstallToOwned,
} from "@/systems/equipment/GearBridge";

function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("Верфь fitting flow — buy → install → uninstall", () => {
  it("a bought item lands in the ТРЮМ and installs onto the hull from the shop", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    acquireUninstalledGear(player, "wpn_pulse");
    expect(ownedUninstalledGear(player, loadout)).toEqual(["wpn_pulse"]);
    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");

    expect(installOwnedGear(player, loadout, "wpn_pulse")).toBe(true);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
  });

  it("the 'Снять' action returns a fitted item to the ТРЮМ (owned store), not the bag", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);
    loadout.install("eq_radar");

    const stripIndex = loadout.installedGearIds().indexOf("eq_radar");
    expect(uninstallToOwned(player, loadout, stripIndex)).toBe(true);
    expect(loadout.installedGearIds()).not.toContain("eq_radar");
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_radar"]);
    expect(inv.modules.length).toBe(0);
  });

  it("УСТАНОВЛЕНО strip index aligns with the slot uninstallToOwned targets", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);
    loadout.install("wpn_pulse");
    loadout.install("wpn_pulse"); // duplicate — second weapon slot
    loadout.install("eq_radar");

    const ids = loadout.installedGearIds();
    const slots = loadout.installedSlots();
    expect(slots.map((s) => s.gearId)).toEqual(ids);

    const radarIdx = ids.indexOf("eq_radar");
    expect(uninstallToOwned(player, loadout, radarIdx)).toBe(true);
    expect(loadout.installedGearIds()).toEqual(["wpn_pulse", "wpn_pulse"]);
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_radar"]);
  });

  it("full shipyard round-trip: buy → install → uninstall → re-install", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    acquireUninstalledGear(player, "eq_scanner");
    expect(installOwnedGear(player, loadout, "eq_scanner")).toBe(true);
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);

    const idx = loadout.installedGearIds().indexOf("eq_scanner");
    expect(uninstallToOwned(player, loadout, idx)).toBe(true);
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_scanner"]);

    expect(installOwnedGear(player, loadout, "eq_scanner")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_scanner");
  });
});
