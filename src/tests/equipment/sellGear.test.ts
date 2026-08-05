import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { ownedUninstalledGear } from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import {
  SELL_RATE,
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";

function playerWith(inventory: Inventory, credits = 0): Player {
  return { inventory, credits } as unknown as Player;
}

describe("sellGearPrice — trade-in rate (basePrice × 0.4)", () => {
  it("is 40 % of base price, floored", () => {
    const pulse = gearById("wpn_pulse")!; // basePrice 800
    expect(sellGearPrice(pulse)).toBe(Math.floor(800 * SELL_RATE));
    expect(sellGearPrice(pulse)).toBe(320);
  });

  it("floors fractional refunds", () => {
    expect(sellGearPrice(gearById("eq_scanner")!)).toBe(1040);
    expect(sellGearPrice(gearById("eq_droid")!)).toBe(2400);
  });

  it("matches the StationScene hull trade-in formula for hulls", () => {
    const hull = gearById("hull_scout")!; // basePrice 1200
    expect(sellGearPrice(hull)).toBe(Math.floor(hull.basePrice * 0.4));
  });
});

describe("sellUninstalledGear — refund + remove from the owned store", () => {
  it("refunds the price and removes the sold copy", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    const player = playerWith(inv, 1000);

    const refund = sellUninstalledGear(player, "wpn_pulse");

    expect(refund).toBe(320);
    expect(player.credits).toBe(1320);
    expect(inv.ownedGearIds).toEqual([]);
  });

  it("removes only one copy when duplicates are owned", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    inv.addOwnedGear("wpn_pulse");
    const player = playerWith(inv, 0);

    expect(sellUninstalledGear(player, "wpn_pulse")).toBe(320);
    expect(inv.ownedGearIds).toEqual(["wpn_pulse"]);
    expect(player.credits).toBe(320);
  });

  it("returns 0 and changes nothing for a gear id that is not owned", () => {
    const inv = new Inventory();
    inv.addOwnedGear("eq_radar");
    const player = playerWith(inv, 500);

    expect(sellUninstalledGear(player, "wpn_pulse")).toBe(0);
    expect(player.credits).toBe(500);
    expect(inv.ownedGearIds).toEqual(["eq_radar"]);
  });

  it("returns 0 for an unknown gear id", () => {
    const inv = new Inventory();
    const player = playerWith(inv, 500);
    expect(sellUninstalledGear(player, "not_a_real_id")).toBe(0);
    expect(player.credits).toBe(500);
  });

  it("cannot sell installed gear (it is not in the owned store)", () => {
    const inv = new Inventory();
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_radar");
    const player = playerWith(inv, 700);

    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
    expect(sellUninstalledGear(player, "eq_radar")).toBe(0);
    expect(player.credits).toBe(700);
    expect(loadout.installedGearIds()).toContain("eq_radar");
  });

  it("sells an owned spare while a fitted duplicate stays installed", () => {
    const inv = new Inventory();
    inv.addOwnedGear("wpn_pulse");
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    const player = playerWith(inv, 0);

    expect(ownedUninstalledGear(player, loadout)).toEqual(["wpn_pulse"]);
    expect(sellUninstalledGear(player, "wpn_pulse")).toBe(320);
    expect(player.credits).toBe(320);
    expect(ownedUninstalledGear(player, loadout)).toEqual([]);
    expect(loadout.installedGearIds()).toContain("wpn_pulse");
  });
});
