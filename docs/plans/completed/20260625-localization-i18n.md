---
# Localization (RU → EN) via an i18n Layer

## Overview
The game's UI is **hardcoded Russian** (dozens of Cyrillic string literals per scene),
which locks out most of a web audience — and the "Neural Onslaught / a boss that's a
real neural net" hook only lands in English. Introduce a tiny **i18n layer**: extract
UI strings into keys with **RU + EN** dictionaries, a `t(key, params)` lookup, and a
language setting (default RU). Mechanical, not hard — and it future-proofs every new
string.

## Context (from discovery)
- **No i18n today** — strings are inline Cyrillic across `src/presentation/*.ts`
  (PlanetScene, InfoCenterScene, StationScene, GovernmentScene, NpcContactPanel, …).
- **Settings precedent:** `fontScale`/`neuralEnabled` localStorage prefs — `language`
  is the same kind (browser-level, no save migration).
- **Text seam:** most panel text already flows through `scaledText(...)` — the ideal
  choke point to swap literals for `t(...)`.

## Development Approach
- **Testing approach: TDD.** `t(key, params)` (lookup, fallback to key, param
  interpolation, missing-key behaviour) and the dictionary completeness check are pure
  and tested. Extraction is mechanical but **incremental + verified**: a coverage test
  grows as scenes migrate, and a "no untranslated literal in migrated scenes" lint/test
  prevents backsliding.
- Default RU (no behaviour change); EN is additive. `language` = localStorage. No
  schema/save change.

## Implementation Steps

### Task 1: i18n core (`t`, dictionaries, language setting)
**Files:**
- Create: `src/i18n/i18n.ts`, `src/i18n/ru.ts`, `src/i18n/en.ts`, `src/tests/i18n/i18n.test.ts`

- [x] `t(key, params?)` resolving against the active language dict with `{param}`
      interpolation and a safe fallback (other-lang → key); `setLanguage/getLanguage`
      over `localStorage("language")` (default `ru`).
- [x] write tests: lookup, interpolation, fallback, missing key, language switch.
- [x] run tests — green.

### Task 2: Dictionary parity guard + extraction tooling
**Files:**
- Create: `tools/i18n/extract.ts` (find inline Cyrillic literals), `src/tests/i18n/parity.test.ts`

- [x] A scanner listing remaining inline Cyrillic literals (migration tracker); a parity
      test asserting `ru` and `en` have identical key sets (no missing translations).
- [x] write tests: parity passes for the migrated set; the scanner reports the backlog.
- [x] run tests — green.

### Task 3: Migrate the high-traffic scenes
**Files:**
- Modify: PlanetScene, StationScene, TradeScene, JobBoard, InfoCenterScene, GovernmentScene, NpcContactPanel (+ MainMenu/Settings)

- [x] Replace inline literals with `t(...)` keys (RU values verbatim, EN translated) in
      the most-seen scenes; route through `scaledText`. (First incremental pass: MainMenuScene,
      TradeScene, JobBoardPanel, NpcContactPanel, SettingsPanel fully migrated to `t(...)`;
      shared key namespaces added — `resource.*`, `faction.*`/`factionType.*`, `role.*`,
      `quest.type.*`, `comms.*`, `trade.*`, `jobBoard.*`, `menu.*`. Remaining scenes stay
      tracked by `tools/i18n/extract.ts` for later passes.)
- [x] write/extend tests: migrated scenes render keys (not literals); parity holds.
      (`src/tests/i18n/migratedScenes.test.ts` asserts each migrated file has zero inline
      Cyrillic literals via the shared `findCyrillicLiterals` core — extracted to
      `src/i18n/cyrillicLiterals.ts` and re-exported by the scanner — and actually calls `t(`.)
- [x] run tests — green.

### Task 4: Language selector in settings + verify
**Files:**
- Modify: the settings panel; verification

- [x] Add a RU/EN selector to the settings interface (live switch + persist); full
      suite + `test:playtest` green; lint/build ok. (Added a fourth **ЯЗЫК** row to
      `SettingsPanel` — public `selectLanguage(lang)` persists via i18n
      `setLanguage` (`localStorage("language")`) and fans the live re-localize out
      through the new `applyLanguage` dep, wired in `FlightHud` to the same
      in-place `refreshFontScale` restyle a font change uses (text nodes re-read
      `t(...)` at creation), then closes the panel — mirroring the font flow.
      Autonym labels (Русский/English) route through identical `lang.ru`/`lang.en`
      dictionary keys so `SettingsPanel` stays free of inline Cyrillic. Neural row
      kept built last to preserve the "neural is the final hit area" contract;
      panel height grown 250→320 for the extra row. Covered by new
      `settingsPanel.test.ts` cases — full suite (3470) + `test:playtest` (240) +
      lint + build all green.)

### Task 5: Documentation
- [x] Document the i18n recipe (new string ⇒ key + ru/en) and the parity guard.
      (Added a "New UI String (i18n / localization)" recipe section to
      `.claude/docs/adding-features.md` — the canonical feature-adding guide,
      `@`-included into CLAUDE.md — covering: add the key to BOTH `ru.ts`/`en.ts`,
      namespacing + `{param}` interpolation, render through `t(...)` via
      `scaledText`, live re-localize, the **parity guard**
      (`src/tests/i18n/parity.test.ts`) + **migrated-scenes guard**
      (`src/tests/i18n/migratedScenes.test.ts`, append-to-`MIGRATED_SCENES`), and
      the `tools/i18n/extract.ts` backlog tracker. Added a matching
      "Internationalization (i18n)" Architecture subsection to CLAUDE.md and
      refreshed the stale "Settings Interface (Speed / Font / Neural)" header →
      "(Speed / Font / Neural / Language)" with the `selectLanguage`/`applyLanguage`
      wiring. All 28 i18n tests green; scanner + extract tool verified.)

## Post-Completion
**Manual:** switch to EN — migrated screens read English; RU unchanged; remaining
backlog is tracked by the scanner for incremental migration.
