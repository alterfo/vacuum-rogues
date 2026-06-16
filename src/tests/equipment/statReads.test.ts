import { describe, it, expect } from "vitest";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * Dual-hull unification: stat reads resolve from the canonical {@link ShipLoadout},
 * the single source of truth. Task 1 introduced `cargoCapacityOf`; Task 5 removed
 * the legacy `PlayerShip.cargoCapacity` getter (and its fallback), so these now
 * read the loadout exclusively.
 *
 * ⚠️ Task 5: the prior assertions on the removed `ship.cargoCapacity` getter and
 * the legacy no-loadout fallback were retired here (they exercised deleted code).
 */
describe("cargoCapacityOf — loadout is the single source of truth", () => {
  it("reads the loadout hull's cargo", () => {
    const loadout = new ShipLoadout("hull_freighter");
    expect(loadout.derivedStats().cargo).toBe(120);
    expect(cargoCapacityOf(loadout)).toBe(120);
  });

  it("tracks the loadout immediately when the hull changes", () => {
    const loadout = new ShipLoadout("hull_corvette");
    expect(cargoCapacityOf(loadout)).toBe(30);

    loadout.setHull("hull_freighter");
    expect(cargoCapacityOf(loadout)).toBe(120);
  });

  it("reports no hold when there is no loadout", () => {
    expect(cargoCapacityOf(null)).toBe(0);
    expect(cargoCapacityOf(undefined)).toBe(0);
  });
});
