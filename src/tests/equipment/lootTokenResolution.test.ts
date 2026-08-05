import { describe, it, expect } from "vitest";
import { gearIdForToken, gearById } from "@/systems/equipment/GearCatalog";
import { ROLE_LOADOUT } from "@/systems/npc/NpcSimulator";

describe("Every NPC loadout token resolves to catalog gear (Task 5 wiring)", () => {
  const allTokens = Object.values(ROLE_LOADOUT).flat();
  const uniqueTokens = [...new Set(allTokens)];

  it.each(uniqueTokens)(
    "resolves loot token %s to a real catalog gear id",
    (token) => {
      const gearId = gearIdForToken(token);
      expect(gearId, `token "${token}" did not resolve to gear`).toBeDefined();
      expect(gearById(gearId as string)).toBeDefined();
    },
  );

  it("a catalog gear id token resolves to itself", () => {
    expect(gearIdForToken("eq_tank")).toBe("eq_tank");
  });

  it("a verbatim catalog display name resolves to its id", () => {
    expect(gearIdForToken("Топливный бак")).toBe("eq_tank");
  });

  it("an unrecognised / junk token resolves to undefined (stays metal salvage)", () => {
    expect(gearIdForToken("salvaged_plating")).toBeUndefined();
    expect(gearIdForToken("")).toBeUndefined();
  });
});
