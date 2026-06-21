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

/**
 * Task 1 (Equipment overhaul): the planet Верфь (EquipmentShopScene) must let the
 * player fit owned/bought gear and pull fitted gear back off — mirroring the
 * StationScene hangar. The scene reuses the canonical GearBridge seams (no new fit
 * logic): a buy lands in the warehouse (`acquireUninstalledGear`), the listing's
 * "[Установить]" row installs it (`installOwnedGear`), and the new "Снять" action on
 * the УСТАНОВЛЕНО strip uninstalls it (`uninstallToOwned`). These tests pin the
 * end-to-end flow and the slot-index invariant the strip's per-chip button depends
 * on — `installedGearIds()` (what the strip iterates) must align with
 * `installedSlots()` (what `uninstallToOwned` indexes).
 */

/** Minimal Player stand-in — the shipyard seams only touch `.inventory`. */
function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("Верфь fitting flow — buy → install → uninstall", () => {
  it("a bought item lands in the ТРЮМ and installs onto the hull from the shop", () => {
    // Mirrors EquipmentShopScene.buyItem → acquireUninstalledGear (warehouse),
    // then the "[Установить]" row → installHeldGear → installOwnedGear.
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);

    acquireUninstalledGear(player, "wpn_pulse");
    expect(ownedUninstalledGear(player, loadout)).toEqual(["wpn_pulse"]);
    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");

    expect(installOwnedGear(player, loadout, "wpn_pulse")).toBe(true);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    // The fitted item leaves the ТРЮМ strip.
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
  });

  it("the 'Снять' action returns a fitted item to the ТРЮМ (owned store), not the bag", () => {
    // Mirrors the new uninstallFittedGear → uninstallToOwned. Canon (Task 1): the
    // shipyard uninstall feeds the owned-gear store (ownedGearIds), not the legacy
    // inventory.modules bag.
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);
    loadout.install("eq_radar");

    const stripIndex = loadout.installedGearIds().indexOf("eq_radar");
    expect(uninstallToOwned(player, loadout, stripIndex)).toBe(true);
    expect(loadout.installedGearIds()).not.toContain("eq_radar");
    expect(ownedUninstalledGear(player, loadout)).toEqual(["eq_radar"]);
    // Goes to the owned store, never the legacy modules bag.
    expect(inv.modules.length).toBe(0);
  });

  it("УСТАНОВЛЕНО strip index aligns with the slot uninstallToOwned targets", () => {
    // The strip renders `installedGearIds()` and wires chip N's "Снять" to slot N.
    // uninstallToOwned indexes `installedSlots()` — the two must stay in lock-step,
    // including with a duplicate fitted, so the clicked chip drops the right part.
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    const player = playerWith(inv);
    loadout.install("wpn_pulse");
    loadout.install("wpn_pulse"); // duplicate — second weapon slot
    loadout.install("eq_radar");

    const ids = loadout.installedGearIds();
    const slots = loadout.installedSlots();
    expect(slots.map((s) => s.gearId)).toEqual(ids);

    // Pull the radar off by its strip index; the two pulse copies stay fitted.
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

    // It is installable again straight from the ТРЮМ.
    expect(installOwnedGear(player, loadout, "eq_scanner")).toBe(true);
    expect(loadout.installedGearIds()).toContain("eq_scanner");
  });
});
