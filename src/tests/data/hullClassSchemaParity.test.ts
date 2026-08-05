import { describe, it, expect } from "vitest";
import { PlayerShipSchema } from "@/validation/schemas";
import { HullClass } from "@/types";

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
