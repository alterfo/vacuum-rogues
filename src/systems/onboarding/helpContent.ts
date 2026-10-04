import { t } from "@/i18n/i18n";

export type HelpKey =
  | "RACE_SELECTION"
  | "SPACE_FLIGHT"
  | "STAR_MAP"
  | "PLANET"
  | "TRADE"
  | "STATION"
  | "EQUIPMENT_SHOP"
  | "GOVERNMENT"
  | "INFO_CENTER"
  | "BANK"
  | "INVENTORY"
  | "TEXT_QUEST"
  | "BLACK_HOLE_ARCADE"
  | "welcome"
  | "quest-journal"
  | "combat"
  | "refuel";

export interface HelpEntry {
  readonly title: string;
  readonly body: string[];
  readonly controls?: string[];
}

export const HELP_SPEC: Record<HelpKey, { body: number; controls: number }> = {
  welcome: { body: 2, controls: 0 },
  RACE_SELECTION: { body: 2, controls: 2 },
  SPACE_FLIGHT: { body: 2, controls: 3 },
  STAR_MAP: { body: 2, controls: 2 },
  PLANET: { body: 2, controls: 2 },
  TRADE: { body: 2, controls: 2 },
  STATION: { body: 2, controls: 2 },
  EQUIPMENT_SHOP: { body: 2, controls: 3 },
  GOVERNMENT: { body: 2, controls: 2 },
  INFO_CENTER: { body: 2, controls: 2 },
  BANK: { body: 2, controls: 2 },
  INVENTORY: { body: 2, controls: 2 },
  TEXT_QUEST: { body: 2, controls: 1 },
  BLACK_HOLE_ARCADE: { body: 2, controls: 2 },
  "quest-journal": { body: 2, controls: 1 },
  combat: { body: 2, controls: 2 },
  refuel: { body: 2, controls: 0 },
};

function baseKey(key: HelpKey): string {
  return `help.${key}`;
}

export function helpI18nKeys(key: HelpKey): string[] {
  const base = baseKey(key);
  const spec = HELP_SPEC[key];
  const keys = [`${base}.title`];
  for (let i = 1; i <= spec.body; i++) keys.push(`${base}.body${i}`);
  for (let i = 1; i <= spec.controls; i++) keys.push(`${base}.control${i}`);
  return keys;
}

function buildEntry(key: HelpKey): HelpEntry {
  const base = baseKey(key);
  const spec = HELP_SPEC[key];
  const entry: HelpEntry = {
    get title() {
      return t(`${base}.title`);
    },
    get body() {
      const out: string[] = [];
      for (let i = 1; i <= spec.body; i++) out.push(t(`${base}.body${i}`));
      return out;
    },
  };
  if (spec.controls > 0) {
    Object.defineProperty(entry, "controls", {
      enumerable: true,
      get(): string[] {
        const out: string[] = [];
        for (let i = 1; i <= spec.controls; i++) {
          out.push(t(`${base}.control${i}`));
        }
        return out;
      },
    });
  }
  return entry;
}

export const HELP_CONTENT: Record<HelpKey, HelpEntry> = Object.fromEntries(
  (Object.keys(HELP_SPEC) as HelpKey[]).map((key) => [key, buildEntry(key)]),
) as Record<HelpKey, HelpEntry>;

export function helpFor(key: HelpKey): HelpEntry {
  return HELP_CONTENT[key];
}
