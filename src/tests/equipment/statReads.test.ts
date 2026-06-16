import { describe, it, expect } from "vitest";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { PlayerShip } from "@/domain/PlayerShip";
import { FactionType, HullClass } from "@/types";

/**
 * Task 1 (dual-hull unification): stat reads must resolve from the canonical
 * `ShipLoadout`, never from the legacy `PlayerShip` hull-class getters. These
 * lock the "loadout is authoritative" decision so the two models can't drift —
 * the root of the "купил корпус, инвентарь не поменялся" bug class.
 */
function makeShip(hullClass: HullClass): PlayerShip {
  return new PlayerShip(
    "ship1",
    "Ship",
    140, // hullHP
    140, // maxHull
    50,
    50,
    100,
    100,
    10,
    5,
    FactionType.PROGRESSORS,
    hullClass,
  );
}

describe("cargoCapacityOf — loadout is the single source of truth", () => {
  it("reads the loadout hull's cargo, not the stale legacy getter", () => {
    // Loadout on a roomy freighter (cargo 120)...
    const loadout = new ShipLoadout("hull_freighter");
    // ...while the legacy ship field still says CORVETTE (cargoCapacity 30).
    const ship = makeShip(HullClass.CORVETTE);

    expect(ship.cargoCapacity).toBe(30); // stale legacy value
    expect(loadout.derivedStats().cargo).toBe(120); // authoritative value
    // The redirect must surface the loadout's hold, ignoring the stale field.
    expect(cargoCapacityOf(loadout, ship)).toBe(120);
  });

  it("tracks the loadout immediately when the hull changes", () => {
    const loadout = new ShipLoadout("hull_corvette");
    const ship = makeShip(HullClass.CORVETTE);

    expect(cargoCapacityOf(loadout, ship)).toBe(30);

    // Swap to a bigger hull on the loadout alone — the legacy ship is untouched.
    loadout.setHull("hull_freighter");

    expect(cargoCapacityOf(loadout, ship)).toBe(120);
    expect(ship.cargoCapacity).toBe(30); // proves the legacy field was NOT read
  });

  it("falls back to the legacy getter only when no loadout exists", () => {
    const ship = makeShip(HullClass.TRANSPORT); // cargoCapacity 45
    expect(cargoCapacityOf(null, ship)).toBe(45);
    expect(cargoCapacityOf(undefined, ship)).toBe(45);
  });
});
