import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  acquireUninstalledGear,
  ownedUninstalledGear,
  gearFit,
} from "@/systems/equipment/GearBridge";

/**
 * Equipment-shop purchase rework (Ship Fitting Task 4). In SR-canon the shop is a
 * warehouse counter: buying gear drops it into the owned-uninstalled store (СКЛАД/
 * ТРЮМ) — it never auto-fits the ship. Installation is a separate hangar action.
 * Each listing surfaces a fit hint (fits / no free <category> slot / over mass)
 * computed from the current hull's category capacity + mass budget, so the player
 * knows before buying whether the item will fit. The hint is a pure projection of
 * `ShipLoadout.canInstall` via `gearFit`.
 */

/** Minimal Player stand-in — the purchase helpers only touch `.inventory`. */
function playerWith(inventory: Inventory): Player {
  return { inventory } as unknown as Player;
}

describe("shop purchase → warehouse (no auto-install)", () => {
  it("a purchase lands in the warehouse, leaving the loadout untouched", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    const loadout = new ShipLoadout("hull_scout"); // free slots available

    acquireUninstalledGear(player, "wpn_pulse");

    // The bought item is in the warehouse…
    expect(ownedUninstalledGear(player, loadout)).toEqual(["wpn_pulse"]);
    // …and nothing was fitted: installing is a separate hangar step.
    expect(loadout.installedGearIds()).toEqual([]);
  });

  it("buying more than the hull can hold still stocks spares in the warehouse", () => {
    const inv = new Inventory();
    const player = playerWith(inv);
    // hull_scout has 2 weapon slots, but the shop never gates on slots — three
    // weapons can be bought and held as spares for a future hull.
    acquireUninstalledGear(player, "wpn_pulse");
    acquireUninstalledGear(player, "wpn_pulse");
    acquireUninstalledGear(player, "wpn_pulse");

    expect(ownedUninstalledGear(player, new ShipLoadout("hull_scout"))).toEqual(
      ["wpn_pulse", "wpn_pulse", "wpn_pulse"],
    );
  });
});

describe("gearFit — per-listing fit indicator", () => {
  it("reports 'fits' when the category bank has room and mass is within budget", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(gearFit(lo, "wpn_pulse")).toEqual({ status: "fits" });
    expect(gearFit(lo, "eq_engine_i")).toEqual({ status: "fits" });
    expect(gearFit(lo, "eq_radar")).toEqual({ status: "fits" });
  });

  it("reports 'no-slot' with the bank counts when that category is full", () => {
    const lo = new ShipLoadout("hull_scout"); // weaponSlots 2
    lo.install("wpn_pulse");
    lo.install("wpn_railgun");
    expect(gearFit(lo, "wpn_scatter")).toEqual({
      status: "no-slot",
      category: "weapon",
      used: 2,
      total: 2,
    });
  });

  it("reports 'over-mass' when a slot is free but mass would exceed the budget", () => {
    const lo = new ShipLoadout("hull_scout"); // massCapacity 30
    lo.install("wpn_torpedo"); // 12
    lo.install("wpn_torpedo"); // 24 → massFree 6
    // The engine slot is empty, but eq_engine_iii (mass 8) > 6 free.
    expect(gearFit(lo, "eq_engine_iii")).toEqual({
      status: "over-mass",
      mass: 8,
      massFree: 6,
    });
  });

  it("an engine/radar swap that fits the mass budget still reports 'fits'", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i"); // occupies the single engine slot
    // A second engine never reports 'no-slot' — it replaces the current one, and
    // the swap frees the old engine's mass, so a within-budget swap still fits.
    expect(gearFit(lo, "eq_engine_iii")).toEqual({ status: "fits" });
  });

  it("reports 'n/a' for a hull (the ship itself) and for an unknown id", () => {
    const lo = new ShipLoadout("hull_scout");
    expect(gearFit(lo, "hull_bastion")).toEqual({ status: "n/a" });
    expect(gearFit(lo, "does_not_exist")).toEqual({ status: "n/a" });
  });
});
