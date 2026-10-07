import { Faction } from "@/types/faction";
import type { FactionType } from "@/types";

export type AnyFaction = Faction | FactionType;

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

export function factionColor(faction: AnyFaction): number {
  return (
    DEFAULT_FACTION_PALETTE[faction as Faction] ??
    DEFAULT_FACTION_PALETTE[Faction.INDEPENDENT]
  );
}
