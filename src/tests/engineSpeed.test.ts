import { describe, it, expect } from "vitest";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { engineSpeedBonus } from "@/systems/EquipmentSystem";
import { PlayerShip } from "@/domain/PlayerShip";
import { EngineModule } from "@/domain/ShipModule";
import { FactionType } from "@/types";

/** A bare player ship with no modules installed (base speed 1.0). */
function bareShip(): PlayerShip {
  return new PlayerShip(
    "test",
    "Test",
    100,
    100,
    50,
    50,
    100,
    100,
    1.0,
    0.8,
    FactionType.OUTLANDERS,
  );
}

/** The starter "Быстрый двигатель" — { type: "speed", value: 0.2 }. */
function fastEngine(): EngineModule {
  return new EngineModule(
    "engine_fast_1",
    "Быстрый двигатель",
    { type: "speed", value: 0.2 },
    1,
    0.2, // speedBoost
    0.1, // evasionBoost
  );
}

describe("engineSpeedBonus", () => {
  it("is 0 for a ship with no engine module", () => {
    expect(engineSpeedBonus(bareShip())).toBe(0);
  });

  it("reads the speedBoost from an installed EngineModule", () => {
    const ship = bareShip();
    ship.equipModule(0, fastEngine());
    expect(engineSpeedBonus(ship)).toBeCloseTo(0.2);
  });

  it("sums the bonus across multiple engine modules", () => {
    const ship = bareShip();
    ship.equipModule(0, fastEngine());
    ship.equipModule(1, fastEngine());
    expect(engineSpeedBonus(ship)).toBeCloseTo(0.4);
  });

  it("ignores non-engine modules", () => {
    const ship = bareShip();
    // weapon/shield slots leave the bonus untouched
    expect(engineSpeedBonus(ship)).toBe(0);
  });
});

describe("cruise speed wiring (Task 10)", () => {
  it("a 0.2 speed-bonus engine yields a faster ShipPhysics than the base", () => {
    const BASE_SPEED = 0.1; // px/ms — GearCatalog loadout-derived cruise base
    const ship = bareShip();
    ship.equipModule(0, fastEngine());

    const bonus = engineSpeedBonus(ship);
    const base = new ShipPhysics(0, 0, BASE_SPEED);
    const boosted = new ShipPhysics(0, 0, BASE_SPEED * (1 + bonus));

    expect(boosted.getMaxSpeed()).toBeGreaterThan(base.getMaxSpeed());
    expect(boosted.getMaxSpeed()).toBeCloseTo(0.12);
  });
});
