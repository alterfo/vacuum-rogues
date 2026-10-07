import { describe, it, expect } from "vitest";
import { Faction } from "@/types/faction";
import {
  DEFAULT_FACTION_PALETTE,
  factionColor,
} from "@/presentation/ui/palette";

describe("palette — faction colours", () => {
  it("renders the historical hues verbatim", () => {
    expect(DEFAULT_FACTION_PALETTE).toEqual({
      [Faction.OUTLANDERS]: 0xff6600,
      [Faction.BASTIONS]: 0xcc0000,
      [Faction.SYNDICATE]: 0x00ff00,
      [Faction.PARADOXES]: 0x9900ff,
      [Faction.PROGRESSORS]: 0x0066ff,
      [Faction.INDEPENDENT]: 0x999999,
      [Faction.OVERMIND]: 0xff33dd,
    });
  });

  it("maps every faction to a distinct colour", () => {
    const values = Object.values(Faction).map((f) => factionColor(f));
    expect(new Set(values).size).toBe(values.length);
  });

  it("factionColor falls back to neutral grey for an unknown faction value", () => {
    expect(factionColor("NOPE" as Faction)).toBe(
      DEFAULT_FACTION_PALETTE[Faction.INDEPENDENT],
    );
  });
});
