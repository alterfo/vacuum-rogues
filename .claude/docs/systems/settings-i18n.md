# Settings Panel & Internationalization

Plans: `docs/plans/20260625-settings-interface-speed-font-neural.md`, `docs/plans/20260625-localization-i18n.md`.

## Settings panel (`src/presentation/ui/SettingsPanel.ts`)

Four rows: СКОРОСТЬ / ШРИФТ / ЯЗЫК / НЕЙРОСЕТЬ. **Mounted by `MainMenuScene`** (not FlightHud). Closes on its own control, outside click, or scene teardown; font/language pick re-renders in place.

Unified accessor (`src/systems/settings/gameSettings.ts`) — no new save field:
- Speed → `GameEngine.gameSpeedMultiplier`
- Font → `src/utils/fontScale.ts` (`localStorage("fontScale")`)
- Neural → `localStorage("neuralEnabled")` (**default false**; `isNeuralEnabled`/`setNeuralEnabled` are aliases over `isFeatureEnabled("neural", …)`)
- Language → i18n `setLanguage` → `localStorage("language")`

**Neural flag = a plain feature gate, NOT a runtime loader.** Off ⇒ rule-based heuristic; on ⇒ pure-TS `NeuralPolicy`. No dynamic `import()` / lazy ONNX path. НЕЙРОСЕТЬ row is **dev-only** (`showNeural` defaults to `import.meta.env.DEV`).

`FlightHud.isSettingsPanelOpen()`/`closeModals()` now track the ♿ accessibility panel (not SettingsPanel) — name retained because `flightKeyHandler` + locked tests key on it.

## i18n

Every player-facing string resolves through `t(key, params?)` (`src/i18n/i18n.ts`). Dictionaries: `src/i18n/ru.ts` (default) and `src/i18n/en.ts` — kept in **lockstep** (a key must exist in both, no empty values). `language` is a browser-level `localStorage` pref (default `ru`) — no save/schema/migration change.

**Rule: add a string ⇒ add a key.** See `.claude/docs/adding-features.md` → "New UI String (i18n / localization)".

Three guards (all run in `npm test`):
- **Parity guard** (`src/tests/i18n/parity.test.ts`) — ru ⇄ en key sets identical, no empty values
- **Migrated-scenes guard** (`src/tests/i18n/migratedScenes.test.ts`) — listed files have zero inline Cyrillic literals and call `t(`
- **No-new-hardcoded-Cyrillic ratchet** (`src/tests/i18n/noHardcodedCyrillic.test.ts`) — per-file baseline over `src/presentation`/`src/systems`/`src/ai`; fails on any *new* Cyrillic literal. Regenerate: `UPDATE_CYRILLIC_BASELINE=1 npm test -- --run src/tests/i18n/noHardcodedCyrillic.test.ts`

Migration scanner: `npx tsx tools/i18n/extract.ts [--list]`.
