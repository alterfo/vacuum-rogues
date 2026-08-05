import { describe, it, expect } from "vitest";
import { Faction } from "@/types/faction";
import { FACTION_LABEL } from "@/config/factionConfig";

describe("FACTION_LABEL completeness", () => {
  it("has a localized label for every Faction enum value", () => {
    for (const value of Object.values(Faction)) {
      expect(
        FACTION_LABEL[value],
        `missing label for Faction.${value}`,
      ).toBeTypeOf("string");
      expect(FACTION_LABEL[value].length).toBeGreaterThan(0);
    }
  });

  it("covers INDEPENDENT and OVERMIND with the established localized text", () => {
    expect(FACTION_LABEL[Faction.INDEPENDENT]).toBe("Независимая");
    expect(FACTION_LABEL[Faction.OVERMIND]).toBe("Сверхразум");
  });
});
