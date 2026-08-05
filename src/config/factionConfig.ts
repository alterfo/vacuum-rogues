import { FactionType } from "@/types";
import { Faction } from "@/types/faction";

export const FACTION_STATS: Record<
  FactionType,
  { hull: number; shields: number; speed: number; evasion: number }
> = {
  [FactionType.OUTLANDERS]: {
    hull: 130,
    shields: 45,
    speed: 0.9,
    evasion: 0.75,
  },
  [FactionType.BASTIONS]: { hull: 150, shields: 60, speed: 0.7, evasion: 0.65 },
  [FactionType.SYNDICATE]: { hull: 80, shields: 40, speed: 1.5, evasion: 0.95 },
  [FactionType.PARADOXES]: { hull: 95, shields: 65, speed: 1.0, evasion: 0.85 },
  [FactionType.PROGRESSORS]: {
    hull: 100,
    shields: 55,
    speed: 1.2,
    evasion: 0.9,
  },
};

export const FACTION_LABEL: Record<Faction, string> = {
  [Faction.OUTLANDERS]: "Окраинники",
  [Faction.BASTIONS]: "Бастионы",
  [Faction.SYNDICATE]: "Синдикат",
  [Faction.PARADOXES]: "Парадоксы",
  [Faction.PROGRESSORS]: "Прогрессоры",
  [Faction.INDEPENDENT]: "Независимая",
  [Faction.OVERMIND]: "Сверхразум",
};

export function factionDisplayLabel(faction: string): string {
  return FACTION_LABEL[faction as Faction] ?? faction;
}
