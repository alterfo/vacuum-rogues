import { Faction } from "@/types/faction";
import type { FactionType } from "@/types";

export type AnyFaction = Faction | FactionType;

export type PaletteMode =
  | "default"
  | "deuteranopia"
  | "protanopia"
  | "tritanopia";

export const PALETTE_MODES: readonly PaletteMode[] = [
  "default",
  "deuteranopia",
  "protanopia",
  "tritanopia",
];

export type FactionPalette = Record<Faction, number>;

export const DEFAULT_FACTION_PALETTE: FactionPalette = {
  [Faction.OUTLANDERS]: 0xff6600,
  [Faction.BASTIONS]: 0xcc0000,
  [Faction.SYNDICATE]: 0x00ff00,
  [Faction.PARADOXES]: 0x9900ff,
  [Faction.PROGRESSORS]: 0x0066ff,
  [Faction.INDEPENDENT]: 0x999999,
  [Faction.OVERMIND]: 0xff33dd,
};

const OI_ORANGE = 0xe69f00;
const OI_SKY_BLUE = 0x56b4e9;
const OI_BLUISH_GREEN = 0x009e73;
const OI_YELLOW = 0xf0e442;
const OI_BLUE = 0x0072b2;
const OI_VERMILLION = 0xd55e00;
const OI_REDDISH_PURPLE = 0xcc79a7;

const OKABE_ITO: readonly number[] = [
  OI_ORANGE,
  OI_SKY_BLUE,
  OI_BLUISH_GREEN,
  OI_YELLOW,
  OI_BLUE,
  OI_VERMILLION,
  OI_REDDISH_PURPLE,
];

const FACTION_ORDER: readonly Faction[] = [
  Faction.OUTLANDERS,
  Faction.BASTIONS,
  Faction.SYNDICATE,
  Faction.PARADOXES,
  Faction.PROGRESSORS,
  Faction.INDEPENDENT,
  Faction.OVERMIND,
];

function rotatedOkabeIto(offset: number): FactionPalette {
  const out = {} as FactionPalette;
  FACTION_ORDER.forEach((faction, i) => {
    out[faction] = OKABE_ITO[(i + offset) % OKABE_ITO.length];
  });
  return out;
}

export const FACTION_PALETTES: Readonly<Record<PaletteMode, FactionPalette>> = {
  default: DEFAULT_FACTION_PALETTE,
  deuteranopia: rotatedOkabeIto(0),
  protanopia: rotatedOkabeIto(3),
  tritanopia: rotatedOkabeIto(5),
};

export const PALETTE_MODE_KEY = "paletteMode";

const VALID_MODES: ReadonlySet<string> = new Set(PALETTE_MODES);

export function currentPaletteMode(): PaletteMode {
  try {
    if (typeof localStorage === "undefined") return "default";
    const stored = localStorage.getItem(PALETTE_MODE_KEY);
    return stored && VALID_MODES.has(stored)
      ? (stored as PaletteMode)
      : "default";
  } catch {
    return "default";
  }
}

export function setPaletteMode(mode: PaletteMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PALETTE_MODE_KEY, mode);
  } catch {
    // Best-effort — a storage-disabled browser simply can't remember it.
  }
}

export function paletteFor(
  mode: PaletteMode = currentPaletteMode(),
): FactionPalette {
  return FACTION_PALETTES[mode] ?? DEFAULT_FACTION_PALETTE;
}

export function factionColor(
  faction: AnyFaction,
  mode: PaletteMode = currentPaletteMode(),
): number {
  const palette = paletteFor(mode);
  return palette[faction as Faction] ?? palette[Faction.INDEPENDENT];
}
