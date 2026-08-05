import { describe, it, expect } from "vitest";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

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
