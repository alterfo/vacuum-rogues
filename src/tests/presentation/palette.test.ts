import { describe, it, expect, beforeEach, vi } from "vitest";
import { Faction } from "@/types/faction";
import {
  PALETTE_MODES,
  FACTION_PALETTES,
  DEFAULT_FACTION_PALETTE,
  PALETTE_MODE_KEY,
  currentPaletteMode,
  setPaletteMode,
  paletteFor,
  factionColor,
  type PaletteMode,
} from "@/presentation/ui/palette";

const ALL_FACTIONS = Object.values(Faction);

describe("palette — colorblind-safe faction colours", () => {
  it("default mode renders the historical hues verbatim (sighted experience unchanged)", () => {
    expect(FACTION_PALETTES.default).toEqual(DEFAULT_FACTION_PALETTE);
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

  it("every mode maps every faction (total mappings)", () => {
    for (const mode of PALETTE_MODES) {
      const palette = FACTION_PALETTES[mode];
      for (const faction of ALL_FACTIONS) {
        expect(palette[faction]).toBeTypeOf("number");
      }
      expect(Object.keys(palette)).toHaveLength(ALL_FACTIONS.length);
    }
  });

  it("every mode's faction colours are mutually distinct (distinguishable)", () => {
    for (const mode of PALETTE_MODES) {
      const values = ALL_FACTIONS.map((f) => FACTION_PALETTES[mode][f]);
      expect(new Set(values).size).toBe(ALL_FACTIONS.length);
    }
  });

  it("each colourblind mode actually remaps away from the default (not a no-op clone)", () => {
    const colourblind: PaletteMode[] = [
      "deuteranopia",
      "protanopia",
      "tritanopia",
    ];
    for (const mode of colourblind) {
      expect(FACTION_PALETTES[mode]).not.toEqual(DEFAULT_FACTION_PALETTE);
    }
    expect(FACTION_PALETTES.deuteranopia).not.toEqual(
      FACTION_PALETTES.protanopia,
    );
    expect(FACTION_PALETTES.protanopia).not.toEqual(
      FACTION_PALETTES.tritanopia,
    );
  });
});

describe("palette — persistence + resolution", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 'default' when unset", () => {
    expect(currentPaletteMode()).toBe("default");
  });

  it("round-trips a mode through localStorage", () => {
    setPaletteMode("deuteranopia");
    expect(localStorage.getItem(PALETTE_MODE_KEY)).toBe("deuteranopia");
    expect(currentPaletteMode()).toBe("deuteranopia");
  });

  it("falls back to 'default' on a corrupt/unknown stored value", () => {
    localStorage.setItem(PALETTE_MODE_KEY, "rainbow");
    expect(currentPaletteMode()).toBe("default");
  });

  it("paletteFor honours an explicit mode and resolves the active mode by default", () => {
    expect(paletteFor("default")).toEqual(DEFAULT_FACTION_PALETTE);
    setPaletteMode("tritanopia");
    expect(paletteFor()).toEqual(FACTION_PALETTES.tritanopia);
  });

  it("factionColor reads through the active mode", () => {
    expect(factionColor(Faction.SYNDICATE, "default")).toBe(0x00ff00);
    setPaletteMode("deuteranopia");
    expect(factionColor(Faction.SYNDICATE)).toBe(
      FACTION_PALETTES.deuteranopia[Faction.SYNDICATE],
    );
    expect(factionColor(Faction.SYNDICATE)).not.toBe(0x00ff00);
  });

  it("factionColor falls back to neutral grey for an unknown faction value", () => {
    expect(factionColor("NOPE" as Faction, "default")).toBe(
      DEFAULT_FACTION_PALETTE[Faction.INDEPENDENT],
    );
  });

  it("degrades to 'default' when localStorage throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    expect(currentPaletteMode()).toBe("default");
    spy.mockRestore();
  });
});
