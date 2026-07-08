/**
 * Task 6 (docs/plans/20260708-font-scale-and-faction-bugs.md): `FACTION_LABEL`
 * used to be keyed by `FactionType` (the 5 player-selectable races), so any
 * `StarSystem.ownerFaction` of `INDEPENDENT`/`OVERMIND` fell through to a raw
 * enum-string fallback wherever a caller rendered `FACTION_LABEL[x] ?? x`.
 * This is a completeness guard: it must cover every `Faction` value (the
 * actual system-ownership enum), not just the playable-race subset, so a
 * future new `Faction` member can't silently regress to a raw string.
 */
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
