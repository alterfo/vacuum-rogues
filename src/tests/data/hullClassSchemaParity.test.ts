import { describe, it, expect } from "vitest";
import { PlayerShipSchema } from "@/validation/schemas";
import { HullClass } from "@/types";

/**
 * Regression guard for the gear-catalog plan (2026-07-19): `hull_cruiser` added
 * `HullClass.CRUISER` to the enum + a buyable catalog entry, but the matching
 * `PlayerShipSchema.hullClass` `z.enum([...])` was NOT widened. Because
 * `applyLoadoutHullToShip` writes `ship.hullClass` into the save and
 * `SaveManager.loadGame` runs `validateSaveState` BEFORE migration, any save
 * where the player had fitted the cruiser hard-rejected on load (a `.default(...)`
 * only fills `undefined`, never an invalid string) — a bricked save.
 *
 * This pins the invariant for EVERY hull class so the next hull-adder can't
 * repeat the miss: the schema must accept every `HullClass` the catalog can
 * write into `ship.hullClass`.
 */
function mkShip(hullClass: string): Record<string, unknown> {
  return {
    id: "Ranger-1",
    name: "Ranger-1",
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    maxShields: 10,
    energy: 0,
    maxEnergy: 10,
    speed: 1,
    evasion: 0,
    hullClass,
  };
}

describe("PlayerShipSchema.hullClass ↔ HullClass parity", () => {
  it("accepts every HullClass enum value the catalog can persist", () => {
    for (const cls of Object.values(HullClass)) {
      const result = PlayerShipSchema.safeParse(mkShip(cls));
      expect(
        result.success,
        `PlayerShipSchema rejected hullClass "${cls}" — add it to the z.enum in schemas.ts`,
      ).toBe(true);
    }
  });

  it("specifically accepts CRUISER (the regression case)", () => {
    expect(PlayerShipSchema.safeParse(mkShip("CRUISER")).success).toBe(true);
  });

  it("still rejects an unknown hull class string", () => {
    expect(PlayerShipSchema.safeParse(mkShip("NOT_A_HULL")).success).toBe(
      false,
    );
  });
});
