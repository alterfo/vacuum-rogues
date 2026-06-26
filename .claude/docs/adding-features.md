# Adding New Features

## New Scene
> Tip: `npx tsx tools/scaffold/new-scene.ts --name <Name> [--context-dependent]` does steps 1–5 automatically (see `tools/README.md`).

1. Create class extending `GameScene` in `src/presentation/`
2. Add `SceneType.MY_SCENE` to `src/types/index.ts`
3. Add a `case SceneType.MY_SCENE:` to `src/core/services/SceneFactory.ts`
4. If the scene requires transient context (planet, NPC, station), add it to `contextDependentScenes` in `GameEngine.loadGame()` so "Continue" falls back to SPACE_FLIGHT instead of a blank screen (currently: `PLANET`, `TRADE`, `DIALOGUE`, `INVENTORY`, `STATION`, `EQUIPMENT_SHOP`, `GOVERNMENT`, `TEXT_QUEST`, `WIN_SCREEN`, `INFO_CENTER`, `BANK`). `loadGame` also routes any *unknown/removed* scene type (e.g. the deleted `COMBAT`) to SPACE_FLIGHT, so retiring a scene never crashes an old save on load.
5. Add Page Object in `e2e/page-objects/` for E2E tests

**Terminal scenes (win/lose, e.g. `WIN_SCREEN`, `GAME_OVER`) must NOT be auto-saved.** `GameEngine.transitionTo()` autosaves to the `"auto"` slot on every gameplay transition; entering a terminal screen would clobber the player's last real checkpoint (and a later "Continue" would re-enter the dead/end screen). Exclude such a scene from that block (`sceneType !== SceneType.X` — see `GAME_OVER`). Pick **one** mechanism per terminal scene: either exclude it from autosave (`GAME_OVER`) **or** keep it in `contextDependentScenes` so a load bounces to SPACE_FLIGHT (`WIN_SCREEN`) — do not leave a terminal scene both resumable and autosaving.

## New Audio Track or SFX
- Music files: `public/audio/mus_<key>.ogg` — add a `TrackKey` entry in `src/systems/AudioManager.ts`
- SFX files: `public/audio/sfx_<key>.ogg` — add a `SfxKey` entry in `src/systems/AudioManager.ts`
- Play from any scene via `this.gameEngine.audio.playTrack(key)` / `this.gameEngine.audio.playSfx(key)`

## New Art Asset
- Drop the file into `src/assets/<category>/` (e.g. `src/assets/planets/`). The Vite glob manifest (`src/assets/manifest.ts`) picks it up automatically — no code change needed. ANY new folder under `src/assets/` becomes a category (glob is `./**/*.{png,jpg,jpeg,webp}`).
- Naming convention: `<type>_<NN>` (e.g. `habitat_07.png`). For per-instance variety, consume via `pickVariant(category, prefix, entityId)` so each entity (planet/ship/star) gets a stable variant by id; add a fallback so the game works before the art is generated.
- Access via `texture(key)` / `texUrl(key)` from `src/presentation/textures.ts`.
- **Compress to WebP before committing.** `src/assets/**` ships as WebP (raw PNG/JPG would re-bloat the repo — it dropped ~581 MB → ~32 MB). After dropping new art run `npx tsx tools/optimize-assets.ts --category <name>` (lossy q80 for photoreal, lossless for `ui`/`icons`); it converts in place and removes the original. Since the manifest keys by extension-less path, `texture("<category>/<name>")` is unchanged. If you add new keys, refresh `src/tests/assets/manifestKeys.snapshot.json` (the key-parity baseline). See `tools/README.md`.
- **Generating art:** the game's own asset pipeline is `tools/comfyui/` (distinct from the audio-reactive ComfyUI). Add a category to `tools/comfyui/asset_prompts.json` (`template` + `axes` + `variants`), then `python3 tools/comfyui/generate_assets.py --category <name> --ckpt <sdxl>.safetensors --clean` on the ComfyUI host (RTX 4090, `oleg@192.168.88.193`) emits `<category>/<name>_NN`; rsync into `src/assets/<category>/`. `--list` previews without generating. **Pass `--ckpt` explicitly** — the default picks the first checkpoint (a Flux model incompatible with `CheckpointLoaderSimple`); use an SDXL model (e.g. `realvisxl_v5.safetensors`). Operational gotchas live in memory `feedback-comfyui-headless-generation`.

## New / Retrained Neural Policy (pure-TS MLP — no ONNX runtime)

There is no ONNX runtime (`onnxruntime-web` was removed — see `docs/plans/20260625-pure-ts-mlp-drop-onnx.md`). The only neural net is the dev-only letsplay player policy (`src/tests/playtest/letsplay/`), a tiny feature-vector MLP run through a hand-written pure-TS forward pass (`mlp.ts`) over weights shipped as a small JSON array. To change/retrain it:

1. Adjust `featurize` width / `ACTION_ORDER` if the I/O changed — keep `FEATURE_LENGTH` in `NeuralPolicy.ts` and `NUM_ACTIONS` in `tools/ai/train_player.py` in lockstep.
2. Generate a behavioural-cloning dataset with `src/tests/playtest/letsplay/exportBcData.ts`.
3. Train + export weights JSON via `tools/ai/train_player.py` (see `tools/ai/README.md`).
4. Drop the `*.weights.json` where `NeuralPolicy` loads it (dev-only); parity is pinned by `weightsContract.test.ts` (within `1e-5`).

For dialogue / tactical AI use the rule-based `FallbackEngine` (`src/ai/FallbackEngine.ts`) — no model file involved. If a net ever genuinely needs a runtime (a conv/transformer), swap `mlp.forward` back to one *then*, not before.

## New Build Define
Vite `define` globals live in `vite.config.ts` (`__DEBUG__`, `__BUILD_VERSION__`, `__BUILD_SHA__` — the last two stamp the beta-feedback diagnostics). A new define needs **both**:
1. The `define` entry in `vite.config.ts` (a `JSON.stringify(...)`'d literal).
2. A matching `declare const __NAME__: ...` in `src/vite-env.d.ts`.

Read it through a `typeof __NAME__ !== "undefined"` guard (see `src/systems/feedback/buildInfo.ts`) so a runtime without the define (a bare Node import / Vitest, which only defines a subset) falls back instead of throwing `ReferenceError`. Note: the deployed build runs in a **separate repo's CI** (the alterfo blog fetches this repo's `master`), so `process.env.GITHUB_SHA`/`npm_package_version` there describe the *blog's* build — prefer the local git checkout / `package.json` for game-identity values.

## New Domain Field
> Tip: `npx tsx tools/scaffold/domain-field.ts --entity <Entity> --field <name> --type <number|boolean|string> --default <v>` does steps 1–3 automatically (see `tools/README.md`).

1. Update type in `src/types/index.ts` or `src/domain/*.ts`
2. Update Zod schema in `src/validation/schemas.ts`
3. Add migration in `src/data/MigrationPipeline.ts` if needed

## New UI String (i18n / localization)

UI text is **key-based** (`docs/plans/20260625-localization-i18n.md`). Every player-facing string resolves through `t(key, params?)` from `src/i18n/i18n.ts` against the active language, so it can be shown in RU **or** EN. The two dictionaries — `src/i18n/ru.ts` (default; verbatim in-game RU) and `src/i18n/en.ts` (English) — are kept in **lockstep**: a key MUST exist in both. `language` is a browser-level `localStorage` pref (`getLanguage`/`setLanguage`, default `ru`), the same class as `fontScale`/`neuralEnabled` — **no save/schema/migration change**.

The recipe — **new string ⇒ key + ru/en**:

1. **Add the key to BOTH dictionaries.** Pick a namespaced key `area.thing` (e.g. `trade.title`, `comms.hullLine`). Put the **verbatim** Russian in `ru.ts` and the English translation in `en.ts`. For dynamic values use `{param}` placeholders (e.g. `"trade.result": "{verb}: {qty}×{name} за {price} кр."`) — `t` interpolates from the `params` object. (Autonyms like Русский/English are intentionally identical in both dicts.)
2. **Render through `t(...)`, not a literal.** Replace the inline Cyrillic string with `t("area.thing")` / `t("area.thing", { qty })`, routed through the scene's `scaledText(...)` choke point. A missing key falls back to the other language, then renders as the bare key (the UI never blanks).
3. **Live re-localize.** Text nodes re-read `t(...)` at creation, so a language switch is applied by the same in-place restyle a font change uses (`FlightHud.refreshFontScale`); the settings panel's **ЯЗЫК** row (`SettingsPanel.selectLanguage`) persists + fans this out.

The three guards (all run in `npm test`):

- **Parity guard** (`src/tests/i18n/parity.test.ts`): fails the moment `ru` and `en` key sets diverge, or any value is empty — so you can't add a key to one dict only, or leave an EN value blank.
- **Migrated-scenes guard** (`src/tests/i18n/migratedScenes.test.ts`): each file in its `MIGRATED_SCENES` list must contain **zero inline Cyrillic string literals** (comments are fine) **and** actually call `t(`. When you finish migrating a scene's literals, **append it to that list** so the gate enforces it (and prevents a re-added literal backsliding).
- **No-new-hardcoded-Cyrillic ratchet** (`src/tests/i18n/noHardcodedCyrillic.test.ts`): the complement to the hard-zero guard above — a **per-file ratchet** over the whole UI source set (`src/presentation` / `src/systems` / `src/ai`) that fails on any **new** Cyrillic literal (file:line reported) without forcing the full backlog migrated at once. The current known backlog is the seeded allow-list `src/tests/i18n/cyrillicBaseline.json`. **Adding a player-facing string the right way (a `t(...)` key) never trips it** — so the rule is simply **add a string ⇒ add a key**. If you intentionally add a Cyrillic *data* literal (a content catalog: ship/captain name, lore prose) or migrate literals out (count drops), regenerate the baseline: `UPDATE_CYRILLIC_BASELINE=1 npm test -- --run src/tests/i18n/noHardcodedCyrillic.test.ts`.

Migration backlog: `npx tsx tools/i18n/extract.ts [--list]` prints the remaining inline-Cyrillic-literal count per file under `src/presentation` / `src/systems` / `src/ai` (skipping the dicts + tests) — the shrinking tracker for incremental scene migration. Its scanner core (`findCyrillicLiterals` + the `scanFiles` walker) lives in `src/i18n/cyrillicLiterals.ts`, shared by the extract tool, the migrated-scenes guard, and the ratchet above.

## Consuming an Accessibility seam (palette / reduced-motion / key remap)

The accessibility pass (`docs/plans/20260625-accessibility-pass.md`, root CLAUDE.md → "Accessibility") added three pure, `localStorage`-backed seams — **read through the seam, never re-derive at a call site** (that is how the colourblind swap / motion damping / rebind reaches your UI). All three are browser-level prefs of the same class as `fontScale`/`neuralEnabled` — **no save/schema/migration change**.

- **Faction colour ⇒ `factionColor(faction, mode?)`** (`src/presentation/ui/palette.ts`). Replace any raw `0x…` faction hue or `FACTION_COLOR`-style map lookup with `factionColor(faction)` (mode defaults to `currentPaletteMode()`; accepts `Faction` **or** `FactionType`). The `default` mode is the historical hues verbatim, so a sighted player sees no change; the three dichromat modes are distinct Okabe-Ito permutations. Adding a colour the player must distinguish? Add it to `DEFAULT_FACTION_PALETTE` + each mode and read it through `factionColor` — don't hardcode it.
- **Idle/decorative motion ⇒ gate on `reducedMotion()`** (`src/presentation/ui/reducedMotion.ts`). Any new idle drift, parallax, twinkle, comet, or heavy particle animation should early-return / freeze when `reducedMotion()` is true (it ORs the in-game toggle with the OS `prefers-reduced-motion`). Read it **per-frame** in `update(dt)` (cheap + storage-guarded); pass an injected `env` in tests. Camera-driven parallax that tracks the ship may stay — freeze the *autonomous* motion, not the player-driven repositioning (see `SpaceBackgroundLayer.update`).
- **A new flight shortcut ⇒ a `FlightAction` + the keymap** (`src/presentation/input/keymap.ts`). Don't add a literal `event.key === "x"` branch to `flightKeyHandler`. Add the action to `FlightAction`/`FLIGHT_ACTIONS`/`DEFAULT_KEYMAP`, switch on it in the handler's `resolveFlightAction(event, ctx.keymap ?? currentKeymap())` result, and add an `action.<name>` i18n key (ru/en) so the ♿ panel's УПРАВЛЕНИЕ section lists + rebinds it automatically. `rebind` already enforces conflict detection.

Surfacing a new control to the player goes in `AccessibilityPanel` (the ♿ HUD panel), **not** `SettingsPanel` (whose hit-area layout is pinned by locked tests) — add a row + an `a11y.*` i18n key (ru/en lockstep) and write through the seam's `set*`. Each seam is unit-tested in isolation (`src/tests/presentation/{palette,reducedMotion,keymap,accessibilityPanel}.test.ts`); a new consumer adds its own test asserting it honours the flag/colour/binding.

# Plan Format (Ralphex)

All implementation plans in `docs/plans/` **must** use ralphex-compatible format — the plan runner rejects files that deviate.

**Required top-level structure (in order):**

```markdown
---
# Plan Title

## Overview
One-paragraph summary.

## Context
Key files, related US/EPICs, current state.

## Development Approach
TDD order, ordering constraints, applicable rules.

## Implementation Steps

### Task 1: Short Title
**Files:**
- Modify: path/to/file.ts
- Create: path/to/new.ts

- [ ] acceptance criterion or implementation step
- [ ] acceptance criterion or implementation step

### Task 2: Short Title
...
```

**Validation rules (enforced by ralphex):**

| Rule | Detail |
|------|--------|
| File starts with `---` | YAML front-matter separator — line 1 |
| `## Overview` present | Required section |
| `## Context` present | Required section |
| `## Development Approach` present | Required section |
| `## Implementation Steps` present | Required section |
| Tasks use `### Task N:` | Colon required; ralphex matches this exact pattern |
| Each task has `- [ ]` checkboxes | At least one per task — tracked as progress |
| `**Files:**` block per task | Recommended for traceability; not validated |

Do **not** use `## 1.` / `## 0.` section numbering — ralphex ignores those.
Use `### Iteration N:` only for time-boxed sprint iterations, not regular tasks.
