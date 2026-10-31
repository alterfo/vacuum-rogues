import { Faction } from "@/types/faction";
import type { StarType } from "@/types";

export interface NebulaAtmosphereState {
  starType?: StarType;
  ownerFaction?: Faction;
  inCombat?: boolean;
  lowHull?: boolean;
  boss?: boolean;
}

export interface NebulaPaletteResult {
  palette: number[];
  overlayColor: number;
  overlayAlpha: number;
}

const PALETTES: Readonly<Record<string, number[]>> = {
  red: [0x6e0a00, 0xcc2000, 0xff4400, 0xff8800, 0xffbb22],
  blue: [0x05082a, 0x0d1a88, 0x2244cc, 0x4466ff, 0x88aaff],
  green: [0x002a14, 0x0a7a3a, 0x18cc66, 0x44ffaa, 0xaaffcc],
  teal: [0x00222a, 0x067a7a, 0x10cccc, 0x44ffff, 0xaaffff],
  amber: [0x2a1600, 0x8a4d00, 0xcc7700, 0xffaa22, 0xffdd88],
  violet: [0x17001f, 0x3a0872, 0x6a1ab8, 0x9d4dff, 0xddb5ff],
};

const FACTION_ACCENTS: Readonly<Record<string, number>> = {
  [Faction.OVERMIND]: 0x9d4dff,
  [Faction.BASTIONS]: 0x88aaff,
  [Faction.SYNDICATE]: 0x44ffff,
  [Faction.OUTLANDERS]: 0x44ffaa,
  [Faction.PROGRESSORS]: 0xffbb22,
  [Faction.PARADOXES]: 0xff77aa,
  [Faction.INDEPENDENT]: 0x8899aa,
};

const COMBAT_OVERLAY = 0xff5040;
const LOW_HULL_OVERLAY = 0xff4033;
const BOSS_OVERLAY = 0xff5c4d;
const IDLE_ALPHA = 0.05;
const COMBAT_ALPHA = 0.1;
const BOSS_ALPHA = 0.14;
const LOW_HULL_ALPHA = 0.16;

export function nebulaPaletteForStarType(starType?: StarType): number[] {
  switch (starType) {
    case "RED_DWARF":
      return PALETTES.red;
    case "BLUE_GIANT":
      return PALETTES.blue;
    case "WHITE_DWARF":
      return PALETTES.teal;
    case "NEUTRON":
      return PALETTES.green;
    case "BLACK_HOLE":
      return PALETTES.violet;
    default:
      return PALETTES.amber;
  }
}

export function resolveNebulaPalette(
  state: NebulaAtmosphereState = {},
): NebulaPaletteResult {
  const lowHull = state.lowHull ?? false;
  const inCombat = state.inCombat ?? false;
  const boss = state.boss ?? false;

  let overlayColor =
    FACTION_ACCENTS[state.ownerFaction ?? ""] ??
    FACTION_ACCENTS[Faction.INDEPENDENT];
  let overlayAlpha = IDLE_ALPHA;

  if (lowHull) {
    overlayColor = LOW_HULL_OVERLAY;
    overlayAlpha = LOW_HULL_ALPHA;
  } else if (inCombat) {
    overlayColor = boss ? BOSS_OVERLAY : COMBAT_OVERLAY;
    overlayAlpha = boss ? BOSS_ALPHA : COMBAT_ALPHA;
  }

  return {
    palette: nebulaPaletteForStarType(state.starType),
    overlayColor,
    overlayAlpha,
  };
}
