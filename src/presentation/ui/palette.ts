// Colorblind-safe palette option (accessibility pass,
// `docs/plans/20260625-accessibility-pass.md`, Task 1).
//
// Faction colours are the centralised swap point for distinguishability: the
// default palette renders the historical hues verbatim (so a sighted player sees
// **no change**), while three dichromat-friendly modes remap every faction onto a
// mutually-distinguishable hue from the Okabe-Ito colour-universal set (each mode
// is a permutation of that 7-colour set, so every mode is total + all-distinct).
//
// The mode is a browser-level `localStorage` pref (`paletteMode`, default
// `"default"`) — the same class of client pref as `fontScale`/`neuralEnabled`, so
// there is **no save-schema/migration change**. Every storage access is
// `typeof`/try-guarded so a runtime without `localStorage` degrades to "default".
//
// UI reads faction colours through `factionColor(faction)` (active mode) — the
// single source of truth shared by the faction-card UI and NPC ship hulls.

import { Faction } from "@/types/faction";
import type { FactionType } from "@/types";

/** A faction colour passed by either enum — both share the same string values. */
export type AnyFaction = Faction | FactionType;

/** Selectable palette modes: the default, plus three dichromat-friendly remaps. */
export type PaletteMode =
  | "default"
  | "deuteranopia"
  | "protanopia"
  | "tritanopia";

/** All modes, in display order (the first is the no-op default). */
export const PALETTE_MODES: readonly PaletteMode[] = [
  "default",
  "deuteranopia",
  "protanopia",
  "tritanopia",
];

/** Full faction→colour map (all 7 `Faction` values, including INDEPENDENT/OVERMIND). */
export type FactionPalette = Record<Faction, number>;

/**
 * The **default** palette — the historical hardcoded hues, verbatim. Keeping this
 * the single source means the colourblind modes are tested against, and the
 * sighted experience never changes.
 */
export const DEFAULT_FACTION_PALETTE: FactionPalette = {
  [Faction.OUTLANDERS]: 0xff6600,
  [Faction.BASTIONS]: 0xcc0000,
  [Faction.SYNDICATE]: 0x00ff00,
  [Faction.PARADOXES]: 0x9900ff,
  [Faction.PROGRESSORS]: 0x0066ff,
  [Faction.INDEPENDENT]: 0x999999,
  [Faction.OVERMIND]: 0xff33dd,
};

// The Okabe-Ito colour-universal design set — 7 hues engineered to stay mutually
// distinguishable under deuteranopia, protanopia *and* tritanopia. Each
// colourblind mode below is a distinct permutation of this set, so it is always
// total (7 keys) and all-distinct (7 unique values).
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

/** Faction order paired against the rotated Okabe-Ito set for each mode. */
const FACTION_ORDER: readonly Faction[] = [
  Faction.OUTLANDERS,
  Faction.BASTIONS,
  Faction.SYNDICATE,
  Faction.PARADOXES,
  Faction.PROGRESSORS,
  Faction.INDEPENDENT,
  Faction.OVERMIND,
];

/** Build a total faction palette from the Okabe-Ito set rotated by `offset`. */
function rotatedOkabeIto(offset: number): FactionPalette {
  const out = {} as FactionPalette;
  FACTION_ORDER.forEach((faction, i) => {
    out[faction] = OKABE_ITO[(i + offset) % OKABE_ITO.length];
  });
  return out;
}

/** Every mode's faction palette. Default = verbatim; the rest = distinct rotations. */
export const FACTION_PALETTES: Readonly<Record<PaletteMode, FactionPalette>> = {
  default: DEFAULT_FACTION_PALETTE,
  deuteranopia: rotatedOkabeIto(0),
  protanopia: rotatedOkabeIto(3),
  tritanopia: rotatedOkabeIto(5),
};

// ---------------------------------------------------------------------------
// Persistence — localStorage("paletteMode"), same class as fontScale
// ---------------------------------------------------------------------------

/** localStorage key holding the active palette mode. */
export const PALETTE_MODE_KEY = "paletteMode";

const VALID_MODES: ReadonlySet<string> = new Set(PALETTE_MODES);

/** Current palette mode, defaulting to `"default"` when unset/invalid/unavailable. */
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

/** Persist a palette mode. Best-effort no-op when storage is unavailable. */
export function setPaletteMode(mode: PaletteMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PALETTE_MODE_KEY, mode);
  } catch {
    // Best-effort — a storage-disabled browser simply can't remember it.
  }
}

// ---------------------------------------------------------------------------
// Colour resolution — the single read seam for the UI
// ---------------------------------------------------------------------------

/** The faction palette for an explicit mode (pure; default = `currentPaletteMode()`). */
export function paletteFor(
  mode: PaletteMode = currentPaletteMode(),
): FactionPalette {
  return FACTION_PALETTES[mode] ?? DEFAULT_FACTION_PALETTE;
}

/**
 * The colour for a faction under the active (or explicit) palette mode — the
 * canonical read seam every UI faction-colour consumer goes through. Accepts
 * either `Faction` or `FactionType` (they share string values); an unknown value
 * falls back to the INDEPENDENT/neutral grey.
 */
export function factionColor(
  faction: AnyFaction,
  mode: PaletteMode = currentPaletteMode(),
): number {
  const palette = paletteFor(mode);
  return palette[faction as Faction] ?? palette[Faction.INDEPENDENT];
}
