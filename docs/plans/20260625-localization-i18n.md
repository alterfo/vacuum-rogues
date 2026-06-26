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

- [ ] A scanner listing remaining inline Cyrillic literals (migration tracker); a parity
      test asserting `ru` and `en` have identical key sets (no missing translations).
- [ ] write tests: parity passes for the migrated set; the scanner reports the backlog.
- [ ] run tests — green.

### Task 3: Migrate the high-traffic scenes
**Files:**
- Modify: PlanetScene, StationScene, TradeScene, JobBoard, InfoCenterScene, GovernmentScene, NpcContactPanel (+ MainMenu/Settings)

- [ ] Replace inline literals with `t(...)` keys (RU values verbatim, EN translated) in
      the most-seen scenes; route through `scaledText`.
- [ ] write/extend tests: migrated scenes render keys (not literals); parity holds.
- [ ] run tests — green.

### Task 4: Language selector in settings + verify
**Files:**
- Modify: the settings panel; verification

- [ ] Add a RU/EN selector to the settings interface (live switch + persist); full
      suite + `test:playtest` green; lint/build ok.

### Task 5: Documentation
- [ ] Document the i18n recipe (new string ⇒ key + ru/en) and the parity guard.

## Post-Completion
**Manual:** switch to EN — migrated screens read English; RU unchanged; remaining
backlog is tracked by the scanner for incremental migration.
