import { describe, it, expect } from "vitest";
import { applyLoadoutHullToShip } from "@/systems/equipment/GearBridge";
import { PlayerShip } from "@/domain/PlayerShip";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { FactionType, HullClass } from "@/types";

function makeShip(): PlayerShip {
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
    HullClass.CORVETTE,
  );
}

describe("applyLoadoutHullToShip — live ship follows the loadout hull", () => {
  it("raises maxHull and updates the hullClass label from the loadout", () => {
    const ship = makeShip();
    const loadout = new ShipLoadout("hull_corvette");
    loadout.setHull("hull_bastion"); // DESTROYER — highest HP

    applyLoadoutHullToShip(ship, loadout);

    expect(ship.hullClass).toBe(HullClass.DESTROYER);
    expect(ship.maxHull).toBe(loadout.derivedStats().maxHull);
    expect(ship.maxHull).toBeGreaterThan(140);
  });

  it("clamps hullHP to the new maxHull when downgrading to a frailer hull", () => {
    const ship = makeShip();
    ship.hullHP = 9999; // over-full from a previous roomy hull

    const loadout = new ShipLoadout("hull_scout"); // LIGHT_FIGHTER — low HP
    applyLoadoutHullToShip(ship, loadout);

    expect(ship.hullClass).toBe(HullClass.LIGHT_FIGHTER);
    expect(ship.maxHull).toBe(loadout.derivedStats().maxHull);
    expect(ship.hullHP).toBeLessThanOrEqual(ship.maxHull);
    expect(ship.hullHP).toBe(loadout.derivedStats().maxHull);
  });
});
