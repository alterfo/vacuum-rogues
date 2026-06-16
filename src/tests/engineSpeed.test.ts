import { describe, it, expect } from "vitest";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * ⚠️ dual-hull Task 5: this file previously tested `engineSpeedBonus(ship)` over
 * the removed `ship.modules` fitting (and `ship.equipModule`). Engine speed is
 * now folded into the canonical loadout's `derivedStats().speed`, which the
 * flight scene reads directly — these are its loadout-based replacements.
 */
describe("loadout-derived cruise speed (dual-hull Task 5)", () => {
  it("a higher-tech engine derives a faster speed than a basic one", () => {
    const basic = new ShipLoadout("hull_corvette");
    basic.install("eq_engine_i");
    const advanced = new ShipLoadout("hull_corvette");
    advanced.install("eq_engine_iii");

    expect(advanced.derivedStats().speed).toBeGreaterThan(
      basic.derivedStats().speed,
    );
  });

  it("no engine means zero derived speed (cannot move)", () => {
    const bare = new ShipLoadout("hull_corvette");
    expect(bare.derivedStats().speed).toBe(0);
  });

  it("an installed engine yields a positive ShipPhysics cruise speed", () => {
    const powered = new ShipLoadout("hull_corvette");
    powered.install("eq_engine_i");
    const speed = powered.derivedStats().speed;
    expect(speed).toBeGreaterThan(0);

    const physics = new ShipPhysics(0, 0, speed);
    expect(physics.getMaxSpeed()).toBeGreaterThan(0);
  });
});
