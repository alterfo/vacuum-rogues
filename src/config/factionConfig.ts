import { FactionType } from "@/types";

// Faction title / description / bonus copy now lives in the i18n catalogs
// (`race.faction.*` keys in `src/i18n/{ru,en}.ts`) and is read through `t()` by
// `RaceSelectionScene` — the single source of truth, so EN renders correctly. The
// former `FACTION_TITLES`/`FACTION_DESCRIPTIONS`/`FACTION_BONUSES` maps were removed
// to avoid a second, drift-prone copy of the same strings.

// Faction colours moved to `src/presentation/ui/palette.ts` (the colorblind-safe
// palette, accessibility pass). Read them through `factionColor(faction)`, which
// renders the historical hues in the default mode and remaps for dichromat modes.

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

export const FACTION_LABEL: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "Окраинники",
  [FactionType.BASTIONS]: "Бастионы",
  [FactionType.SYNDICATE]: "Синдикат",
  [FactionType.PARADOXES]: "Парадоксы",
  [FactionType.PROGRESSORS]: "Прогрессоры",
};
