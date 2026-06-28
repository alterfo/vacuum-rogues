// Help-content registry for the onboarding / contextual-help layer
// (`docs/plans/20260623-onboarding-and-contextual-help.md`).
//
// The instructions for every reachable gameplay screen — plus the first-flight
// `welcome` intro (states the game's goal), the in-flight `quest-journal` panel,
// and the one-shot `combat` hint — are **localized**: each `title`/`body`/
// `controls` string resolves through the i18n layer (`t(...)`), so the help panel
// renders in RU or EN and re-reads live on a language change (like other migrated
// scenes). The Russian/English text itself lives in `src/i18n/ru.ts` / `en.ts`
// under the `help.<key>.*` keys; this file holds only the key shapes + lookup, no
// PixiJS/DOM deps so the registry stays trivially unit-testable.

import { t } from "@/i18n/i18n";

/**
 * A help topic. Scene-based keys reuse the {@link import("@/types").SceneType}
 * string values so a caller can pass the scene type directly; the three extra
 * keys (`welcome`, `quest-journal`, `combat`) cover the in-flight surfaces that
 * are not their own scene.
 */
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
  | "welcome"
  | "quest-journal"
  | "combat";

/** One screen's instructions: a heading, body paragraphs, optional controls. */
export interface HelpEntry {
  /** Short panel title. */
  readonly title: string;
  /** One or more concise paragraphs (≥1). */
  readonly body: string[];
  /** Optional list of key/control hints (rendered as a list). */
  readonly controls?: string[];
}

/**
 * How many `body` paragraphs and `controls` lines each help key has. Drives the
 * `help.<key>.body{N}` / `help.<key>.control{N}` i18n key bases — the single
 * source of truth shared by the live `HELP_CONTENT` getters and the i18n parity
 * test. A key with `controls: 0` has **no** controls section (its entry omits the
 * optional `controls` field entirely).
 */
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
  "quest-journal": { body: 2, controls: 1 },
  combat: { body: 2, controls: 2 },
};

/** The i18n key base for a help key, e.g. `welcome` → `help.welcome`. */
function baseKey(key: HelpKey): string {
  return `help.${key}`;
}

/**
 * All i18n keys a help entry resolves through (title + each body/control line),
 * derived from {@link HELP_SPEC}. Exported so the i18n parity test can assert
 * every onboarding key exists in **both** catalogs.
 */
export function helpI18nKeys(key: HelpKey): string[] {
  const base = baseKey(key);
  const spec = HELP_SPEC[key];
  const keys = [`${base}.title`];
  for (let i = 1; i <= spec.body; i++) keys.push(`${base}.body${i}`);
  for (let i = 1; i <= spec.controls; i++) keys.push(`${base}.control${i}`);
  return keys;
}

/**
 * Build a live {@link HelpEntry} whose `title`/`body`/`controls` resolve through
 * `t(...)` at access time — so the help panel re-reads the active language each
 * time it is opened. The `controls` getter is defined only when the key actually
 * has control lines (so a key like `welcome` reports `controls === undefined`).
 */
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

/**
 * Instructions for every reachable gameplay screen + the intro/hints. Each
 * entry's strings resolve live through `t(...)`, so the registry renders in the
 * active language and updates on a language change. Object identity per key is
 * stable (each entry is built once), so `helpFor(key) === HELP_CONTENT[key]`.
 */
export const HELP_CONTENT: Record<HelpKey, HelpEntry> = Object.fromEntries(
  (Object.keys(HELP_SPEC) as HelpKey[]).map((key) => [key, buildEntry(key)]),
) as Record<HelpKey, HelpEntry>;

/** Return the help entry for a key. */
export function helpFor(key: HelpKey): HelpEntry {
  return HELP_CONTENT[key];
}
