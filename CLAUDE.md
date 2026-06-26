# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Galactic Horizon: Neural Onslaught** — browser-based space RPG/strategy game with tiny **pure-TS neural policies** (and a rule-based `FallbackEngine`) for tactical AI and dialogue. Built with TypeScript and PixiJS 8. (`onnxruntime-web` was removed — see "Neural / AI Pipeline" below.)

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint check on src/**/*.ts
npm test             # Run Vitest unit tests (watch mode)
npm test -- --run    # Run unit tests once (CI mode)
npm run test:e2e            # Run Playwright E2E tests (starts dev server on port 5175 automatically)
npm run test:e2e:headed     # E2E with visible browser
npm run test:e2e:debug      # E2E in debug mode
npm run test:e2e:regression # Run regression playtest suite only (fast gate, < 60 s, for CI)
npm run test:playtest       # Real-engine playtest suite (pre-push gate, ~3 s)
npm run letsplay            # Dev-only letsplay bug-finder — an agent plays the real engine
npm run letsplay:ci         # Letsplay CI oracle (pre-push + CI gate, ~2.5 s): K seeded sessions + static oddity assertions (balance/asset/visual)
```

**Run single test file:** `npm test -- --run src/tests/pathfinding.test.ts`

**E2E note:** E2E tests start their own dev server on port 5175 (`playwright.config.ts`). Do not rely on a running `npm run dev` instance for E2E.

## TypeScript Configuration

- Strict mode enabled (`strict: true`, `noImplicitAny`, `noUnusedLocals`)
- Path alias: `@/*` → `src/*`
- Target: ES2022, module: ESNext
- `__DEBUG__` global available (true in development)

## Architecture

### Layer Structure (strict dependency direction: top → bottom only)

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Presentation | `src/presentation/` | PixiJS scenes, sprites, rendering, player input |
| Systems | `src/systems/` | GameEngine, AudioManager, trade, dialogue, galaxy generation; sub-modules: `equipment/`, `npc/`, `quests/`, `info/`, `combat/`, `galaxy/`, `trade/` (route scanner + rumor lifecycle), `onboarding/` (contextual-help content registry + browser-level "seen" persistence) |
| Domain | `src/domain/` | Pure entities (Player, Galaxy, StarSystem) — no PixiJS/ONNX/DOM deps |
| AI/Infrastructure | `src/ai/`, `src/data/` | Rule-based `FallbackEngine` (+ adaptive quality profile, template narrator), IndexedDB, save management. Neural policies are tiny pure-TS MLPs (`src/tests/playtest/letsplay/mlp.ts`) — no ONNX runtime |
| Types/Config | `src/types/`, `src/config/` | Shared types, enums, balance constants; `FactionType` replaces old `RaceType` |

### Key Entry Points

- `src/main.ts` — App entry: Service Worker registration, GameEngine initialization, boot gates (`checkDomainLock` + the soft mobile gate, below)
- `src/systems/GameEngine.ts` — Central engine: scene transitions, game loop, save coordination
- `src/presentation/GameScene.ts` — Base scene class: `initialize()`, `update(dt)`, `destroy()`

### Soft Mobile Gate

A **soft, dismissible** boot notice for phone-class visitors (`docs/plans/20260623-mobile-device-soft-gate.md`) — the game is keyboard/large-screen oriented, so a friendly in-universe overlay sets expectations without hard-locking anyone out. The engine still boots underneath; **desktop is unaffected** (the gate never shows).

- **Detection** (`src/systems/device/isMobileDevice.ts`): pure, injectable `isMobileDevice(env?)` = `coarse && (small || phoneUA)` — a coarse primary pointer (`matchMedia('(pointer: coarse)')`, falling back to `maxTouchPoints`) AND either a small viewport (`min(w,h) < MOBILE_MAX_VIEWPORT_PX` = 768) or a phone user-agent. Conservative by design: tablets/hybrids/large touchscreens keep their desktop profile; missing APIs degrade toward "not mobile". `env` defaults to live `window`/`navigator`, read through `typeof` guards (safe under Vitest).
- **Persistence** (`src/systems/device/mobileGateState.ts`): browser-level `localStorage` flag `sr_mobile_ack` (same kind as `sr_settings`/`sr_help_seen` — **no save-schema/migration change**). `wasDismissed()`/`markDismissed()` + the pure decision `shouldShowMobileGate(env?, store?)` = `isMobileDevice() && !wasDismissed()`; both injectable and degrade to "not dismissed"/no-op when storage is unavailable.
- **Overlay + wiring**: the hidden `#mobile-gate` HTML/CSS overlay lives in `src/index.html` (themed like the boot loader); `maybeShowMobileGate()` in `main.ts` reveals it when `shouldShowMobileGate()` is true and «Всё равно продолжить» hides it + `markDismissed()` (so it won't nag on the next load).

### Settings Interface (Speed / Font / Neural / Language)

One unified in-flight settings panel surfaces four player-facing controls — **game speed**, **font size**, the **neural-AI toggle** (`docs/plans/20260625-settings-interface-speed-font-neural.md`), and the **RU/EN language selector** (`docs/plans/20260625-localization-i18n.md`, see "Internationalization" below). It's opened by the ⚙ HUD button (replacing the old font-only stub) and closes on Esc / outside-click through the existing `isSettingsPanelOpen` + `closeModals` wiring in `flightKeyHandler` (unchanged).

- **Unified accessor** (`src/systems/settings/gameSettings.ts`): each control delegates to its existing store — **no new save-state field, no schema/migration**. `getSpeed/setSpeed` read/write `GameEngine.gameSpeedMultiplier` (validated against `GAME_BALANCE.gameSpeedMultipliers`, snapping unknown values to `gameSpeedDefault`); `getFontKey/setFontKey` delegate to `src/utils/fontScale.ts` (`localStorage("fontScale")`); `isNeuralEnabled/setNeuralEnabled` read/write the browser-level `localStorage("neuralEnabled")` flag — **default `false`**, the same class of client pref as `sr_settings`/`sr_mobile_ack`. Every storage access is `typeof`/try-guarded so a runtime without `localStorage` degrades to "off"/no-op rather than throwing.
- **Feature flags are generalised** (`FeatureFlag` / `isFeatureEnabled` / `setFeatureEnabled` in the same file): neural is the **first** flag — add future opt-in/experimental systems here so they share the same default-off, storage-degrading gate. `isNeuralEnabled`/`setNeuralEnabled` are thin aliases over `isFeatureEnabled("neural", …)`.
- **Neural flag = a plain feature gate, NOT a runtime loader.** `onnxruntime-web` is fully removed (below), so the neural net is a tiny pure-TS MLP that just runs — there is nothing heavy to lazy-load. The toggle simply selects which brain plays: off (default) ⇒ the rule-based heuristic, **no MLP weights touched**; on ⇒ the pure-TS `NeuralPolicy` (inert until trained weights are dropped in). This is the gate the (deferred) Overmind neural AI will sit behind. Do **not** re-introduce a dynamic `import()` / lazy ONNX path — the plan's original "lazy ONNX" framing predates the runtime removal.
- **Panel** (`src/presentation/ui/SettingsPanel.ts`): self-contained component (СКОРОСТЬ / ШРИФТ / НЕЙРОСЕТЬ / ЯЗЫК rows); each control writes through `gameSettings` (language through i18n `setLanguage`) and fans the live effect out via `SettingsPanelDeps` callbacks (`applySpeed` → HUD label + physics `timeScale`; `applyFont` → in-place restyle then close; `onNeuralToggle` → the policy gate; `applyLanguage` → the same in-place re-localize a font change uses, then close). Control actions are public (`selectFont`/`selectSpeed`/`toggleNeural`/`selectLanguage`) so the behaviour is unit-testable without PixiJS pointer events. The НЕЙРОСЕТЬ row is built **last** to keep it the final hit area.

### Internationalization (i18n)

UI text is **key-based** (`docs/plans/20260625-localization-i18n.md`): every player-facing string resolves through `t(key, params?)` (`src/i18n/i18n.ts`) against the active language, so it renders in RU **or** EN. The dictionaries `src/i18n/ru.ts` (default, verbatim in-game RU) and `src/i18n/en.ts` (English) are kept in **lockstep** — a key must exist in both. `language` is a browser-level `localStorage` pref (`getLanguage`/`setLanguage`, **default `ru`**), the same class as `fontScale`/`neuralEnabled` — **no save/schema/migration change**. `translate(lang, key, params)` is the pure resolver (active dict → other dict → bare key, `{param}` interpolation); `t` is the live wrapper scenes call, routed through `scaledText`. **Adding/migrating strings: see `.claude/docs/adding-features.md` → "New UI String (i18n / localization)".** Two test gates back it: the **parity guard** (`src/tests/i18n/parity.test.ts` — ru ⇄ en key sets identical, no empty values) and the **migrated-scenes guard** (`src/tests/i18n/migratedScenes.test.ts` — files in its `MIGRATED_SCENES` list hold zero inline Cyrillic literals and call `t(`; append a scene there once migrated). The migration backlog is tracked by `npx tsx tools/i18n/extract.ts [--list]` (pure scanner core `src/i18n/cyrillicLiterals.ts`, shared with the guard).

### Neural / AI Pipeline (pure-TS, no ONNX runtime)

The only neural nets this game needs are **tiny feature-vector MLPs** (e.g. the letsplay player policy, `18→32→10` ≈ 938 weights ≈ 896 MACs — the input grew 12→18 when the agent-memory plan appended a 6-wide belief block to `featurize`). They run through a **hand-written pure-TS forward pass** (`src/tests/playtest/letsplay/mlp.ts` — matmul + ReLU + argmax) over **weights shipped as a small JSON array (~3 KB)**, inline on the CPU in microseconds — **no worker, no WebGPU, no wasm**. `onnxruntime-web` was dropped (`docs/plans/20260625-pure-ts-mlp-drop-onnx.md`); a dependency guard (`src/tests/architecture/noOnnxRuntime.test.ts`) keeps every `onnxruntime*` import out of `src/**` and the dead ONNX scaffolding (registry/worker/cache/manifest/adapters/port) deleted.

- **`FallbackEngine` (`src/ai/FallbackEngine.ts`) is the canonical rule-based engine** for dialogue / tactical AI — pure templates, no model. `DialogueSystem` and the template `QuestNarrator` (`src/ai/adapters/QuestNarrator.ts`) run on it; the old `T5DialogueAdapter`/`GRUEmotionAdapter` are now rule-based placeholders.
- **`NeuralPolicy`** (`src/tests/playtest/letsplay/NeuralPolicy.ts`, dev-only) keeps its runtime-agnostic `featurize → forward → mapNetOutputToAction` seam: with a trained `*.weights.json` it returns the argmax legal action; with none it's inert and falls back to the `HeuristicPolicy` (unchanged contract). Training stays in PyTorch on the 4090 (`tools/ai/train_player.py`) and **exports weights as JSON** (not ONNX), pinned by a parity test (`weightsContract.test.ts`, within `1e-5`).
- **The neural policy is feature-gated** (`selectPlayerPolicy` in `src/tests/playtest/letsplay/policyGate.ts`): it consults `isNeuralEnabled()` (the settings-panel toggle's `localStorage("neuralEnabled")` flag, **default false**) — off ⇒ a fresh `HeuristicPolicy` is returned and the `NeuralPolicy` is **never constructed** (no weights loaded); on ⇒ a `NeuralPolicy`. The gate and the settings panel read the **same** flag source of truth (`gameSettings.isNeuralEnabled`); `enabled` is injectable for tests. See "Settings Interface" above.
- **If a net ever genuinely needs a runtime** (a conv/transformer), swap `forward` back to one *then* — not before. At MLP scale, GPU/worker dispatch overhead ≫ the compute.

### Texture Loading

`src/presentation/textures.ts` — `LAZY_PREFIXES` excludes heavy categories from eager boot preload. Current lazy categories: `panoramas/`, `surfaces/`, `planet_maps/`, `star_maps/`, `stars/`, `nebula/`.

**Pattern for lazy categories** (must NOT use synchronous `pickVariant`):
```typescript
const key = pickVariantKey("nebula", prefix, seed);
if (key) {
  const cached = tex(key);
  if (cached) mount(cached);
  else void loadTextureAsync(key).then((t) => { if (t && !this.sceneDestroyed) mount(t); });
}
```
Any new art category with >10 MB total must be added to `LAZY_PREFIXES`.

**Assets are WebP.** All `src/assets/**` art is WebP (converted from PNG/JPG, ~581 MB → ~32 MB). The manifest (`src/assets/manifest.ts`) keys by path **without** extension and globs `.webp`, so swapping `x.png` → `x.webp` leaves `texture("<cat>/<name>")` resolving unchanged — the conversion is transparent to every caller. New PNG/JPG art must be run through `tools/optimize-assets.ts` (needs the `sharp` devDep; lossy q80 for photoreal, lossless for `ui`/`icons`) before commit; key-parity is locked by `src/tests/assets/manifestKeys.snapshot.json`.

## Domain & Types
- Domain fields should be `readonly`. Mutation via explicit methods only.
- **Any change to `src/types/index.ts` or `src/domain/**/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break. This includes the АБС ledger types in `src/domain/banking/Ledger.ts` (`Account`/`Posting`/`JournalEntry`/`BankingSnapshot`/`LoanDefaultSnapshot`), mirrored by `Ledger*Schema`/`BankingSnapshotSchema`/`LoanDefaultSnapshotSchema`.
- **A new *persisted* domain field** additionally needs a `src/data/MigrationPipeline.ts` migration that defaults it for old saves, with a `CURRENT_VERSION` bump (e.g. the per-run `Player.gameMode` field added v26→27, defaulting old saves to `"NORMAL"`). Two kinds of persisted field need **no migration + no version bump**: (a) a purely **catalog-derived** field the schema already tolerates (mass, `ownedGearIds`, per-loan default state); and (b) an **optional, additive** field whose absence is a safe default — mark it `.optional()` in the schema and old saves simply omit it (e.g. `SaveState.banking`, and `SaveState.flightShipPos` — the last in-flight ship position, restored only when its `systemId` matches the loaded system and the ship was not landed, else the ship edge-spawns as before). A version bump is required only when an old save's value must be *defaulted* to something other than "absent". See the cases in the sections below.
- **Don't add a persisted field for the quest-board "no repeats" dedupe.** The board excludes quests the player already has by **deriving keys from already-persisted state** (active + pending-return quests via `questKey`/`questKeyForQuest`, completed quests by id) — there is deliberately **no `seenQuestKeys` save field** (it was the rejected design, since it would force the full schema + migration + version-bump lockstep). See "Board dedupe (no repeats)" in `docs/requirements/epics/archived/EPIC-008-quest-generation-and-missions.md`.
- **Branching text-quests are catalog data, not a persisted field.** The hand-authored "interesting" quests are `QuestScript`s in `src/systems/quests/scripts/` (run by `QuestVM`), wired in via the single `ALL_QUEST_SCRIPTS` list in `TextQuestRegistry.ts`; the board's TEXT_ADVENTURE slot picks one uniformly in `QuestGenerator.buildTextQuest` and stores `script.id` as `targetObjectId`. Adding one needs **no schema/migration/save bump** — see the add-a-quest recipe + catalogue in `src/systems/quests/scripts/README.md`.

## Save Compatibility: Never Brick a Beta-Tester's Progress

Beta-testers have **real, progressed saves**. Every balance/schema/catalog change must keep an old save **load → migrate → playable** (`docs/plans/20260625-save-compatibility-safety-net.md`). Classify your change and follow the matching rule:

- **Persisted-field change ⇒ migration + a golden save.** Schema + `MigrationPipeline` + `CURRENT_VERSION` bump (the lockstep above), **and** add/refresh a golden-save fixture so the round-trip is gated. Fixtures live in `src/tests/data/goldenSaves/` (`early-current.json`, `late-banking-current.json` + the hand-pinned lower-version `legacy-v1.json` / `progressed-v23.json` that exercise the full migration chain); `src/tests/data/goldenSaves/README.md` documents the two add paths (`GEN_GOLDEN=1` regenerates current-version fixtures from the real engine; hand-pin a lower-version JSON for the chain).
- **Catalog/`GearCatalog` change ⇒ load revalidation, no migration.** Catalog edits are runtime-applied, but a hull whose **slots/mass capacity shrinks** can leave a progressed loadout over-capacity. `ShipLoadout.revalidateToCurrentHull()` (extracted `evictToCurrentHullCapacity` shared with `swapHull`) re-runs the per-category + mass eviction against the *current* hull (keeping hull micromodules); `GameEngine.loadGame` calls it right after `fromJSON` and re-bags each dropped slot losslessly via `slotToBagModule`. So a catalog shrink trims the excess to the bag instead of loading an invalid state — **never** silently corrupts the save.
- **Generation change ⇒ new-games-only, existing saves safe.** The galaxy (and most world state) is persisted via `SaveStateSchema.galaxy`, so star-type / market / seeding changes affect **new games only** — a loaded save keeps its already-generated world. No action needed for old saves.
- **The gate:** `npm run test:save-compat` (`goldenSaveCompat.test.ts` + `loadoutRevalidateOnLoad.test.ts`, ~2 s) asserts every golden save loads→migrates→validates with intact credits/galaxy + a takeoff-capable loadout and zero logged errors. It runs as the `save-compat` **pre-push** command (`lefthook.yml`) and a dedicated **CI workflow** (`.github/workflows/save-compat.yml`), so a save-breaking change fails with a clear, named signal.

## Difficulty Modes: God / Normal / Hard

`Player.gameMode` (`GameMode = "GOD" | "NORMAL" | "HARD"`, `docs/plans/20260620-game-difficulty-modes-god-normal-hard.md`) is a **per-run** choice picked on the new-game screen (`RaceSelectionScene`), persisted on the save (not `PlayerSettings`) and set only via `Player.setGameMode`. Absent/old saves ⇒ `NORMAL` (the death + hostile paths behave exactly as before).

- **GOD = ship never destroyed.** `src/systems/combat/godMode.ts` is the single source of truth: `hullFloorFor(mode,maxHull)` = `ceil(maxHull × GOD_MODE_HULL_FLOOR_FRACTION)` (≥1, never 0) in GOD / 0 otherwise; `applyDamageWithMode(...)` floors the hull above 0 in GOD and clamps to 0 (old `Math.max(0,…)`) in NORMAL/HARD. **"Downed" is *derived*, never persisted** — `isDowned(player)` re-computes `gameMode===GOD && hull ≤ floor` from current hull, so a save/load while downed re-derives it and a repair above the floor clears it automatically. **Route every player-hull damage path through `applyDamageWithMode`** (combat `CombatModule.fireNpcShot`, sun contact `StarRenderer.updateSunContactDamage`) and every fire/jump gate through `isDowned` (`CombatModule`, `SpaceFlightScene.performWarp`, `StarMapScene.performWarpJump`) — do not re-derive the floor or the downed rule at a call site. The GOD floor pre-empts the death/GAME_OVER trigger. (The legacy hex `CombatScene` is gone — combat is real-time in-flight only, so the OVERMIND-core boss and former text-quest encounters all resolve through `CombatModule`, already covered by `applyDamageWithMode`/`isDowned`.)
- **HARD scaling is config-only** in `src/config/balance.ts` (`DIFFICULTY_HOSTILE_SCALING` — HARD ×1.5 hostile systems, garrison +2; NORMAL/GOD = ×1.0/+0). `GameEngine.applyDifficultyHostileScaling` augments the boot-generated galaxy's hostile seeding (extra overmind/pirate systems persist via `GalaxySchema`) and `NpcSimulator.setGameMode` grows the daily garrison `[min,max]` — both re-armed on load. Tune in `balance.ts`, never at call sites.

## Money System: the Ledger is Canonical (АБС core-banking)

All in-game credits live in a **double-entry general ledger** (`src/domain/banking/Ledger.ts`) — the authoritative book of record for the in-game core-banking prototype ("АБС", `docs/plans/20260619-abs-core-banking-prototype.md`). `player.credits` is a **read projection** of the player's current-account GL balance (`cur:<playerId>`), rewritten by `bindCreditsProjection` on every `BalanceChanged` event — **not** a directly-mutated field.

- **NEVER write `player.credits ±= x` (or `npc.credits`) directly.** Move money through the bus: call `adjustPlayerCredits(bank, player, signedDelta, counterpartyId, reason)` / `creditNpc(...)` / `transfer(...)` from `src/systems/banking/economy.ts`, which dispatch a balanced `Transfer`. For credits moving **from the player to an NPC** (pirate tribute, merc hire fee) use `payTribute(...)` / `payHire(...)` — thin wrappers over the private `payPlayerToNpc` that book a balanced player→NPC `Transfer` (counterparty = the NPC's current account, opened+seeded on first use). The `BalanceChanged` event writes the new balance back into `player.credits`, so the net delta is identical to the old direct mutation but money now has a real double-entry source/sink. A credit-write added the old way desyncs the projection from the ledger and is **not** caught by a failing test (the `economy.ts` fallback silently direct-mutates `credits` when no bank is wired).
- **`player.credits` is whole-number currency** (`PlayerSchema.credits` is `int()`). EOD interest leaves savings/loan balances fractional, so any move onto a CURRENT account must be whole (`wholeCreditsToCurrent` in `bankSceneView.ts`) — a fractional projected balance throws on reload (`validateSaveState`).
- **Where it lives:** ledger + snapshot in `src/domain/banking/Ledger.ts` (pure domain, no PixiJS/DOM); the typed command/event bus ("универсальная шина") in `src/systems/banking/bus.ts` (one command handler — `setHandler` throws on a second — plus event fan-out + command observers for the visualization); the `BankingService` handler in `src/systems/banking/BankingService.ts`; the economy seam + GL counterparty ids in `economy.ts`; retail savings/loan products in `products.ts`; the pure **loan-default state machine** (penalty multiplier, default threshold, missed/serviced transitions) in `loanDefault.ts`. `GameEngine` owns `bankBus` + `bankingService` and exposes `.bank` (`{bus, service}`) for scenes/systems to thread in. `BankingService` owns no reputation: when EOD trips a player loan into default it publishes a one-shot `LoanDefaulted` bus event, and `GameEngine` subscribes to apply the bank-faction reputation hit (`BANK_FACTION_ID = BASTIONS`, `−15`, once per default crossing).
- **EOD batch:** `GameEngine.advanceGalaxyDay()` dispatches `RunEndOfDay`, which **first drives each loan's default machine** (`processLoanDefaults`: detect an overdue due, opportunistically seize whole credits current→loan toward the debt via a balanced `Transfer`, write off a sub-credit residual, record paid/missed → flip the penalty rate and, at the threshold of consecutive misses, `defaulted`), then accrues interest (overdue loans at the ×penalty rate), cuts statements, and rolls the business date. Idempotent per business date.
- **Persistence:** the ledger snapshot persists via `SaveState.banking` / `BankingSnapshotSchema`. The snapshot also carries **per-loan default/arrears state** (`loanDefaults`: missed-payment count, penalty-active, defaulted flag, next-due business date, owed-at-last-due baseline — `BankingService.toSnapshot()`/`restore()`); the field is **optional**, so a save made before it existed re-seeds each outstanding loan lazily (current, not defaulted) at the next EOD — **no save-version bump**. Old saves lack `banking` entirely: on load the service is first `resetLedger()`'d to a fresh seeded ledger (clears any prior in-session game's books — load-bearing, else the Bank UI shows the previous game's accounts) and then the player current account is re-seeded from `credits` (idempotent re-seed).

## Errors & Logging
- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

## Bug Fixing Process (regression-first)

Every bug follows this order — no exceptions:
1. **Reproduce as a red test first** — write a failing regression test (unit test, or E2E in `playtest-regression.spec.ts` for visual/interaction bugs).
2. **Fix until the test goes green.** Do not claim a fix without the test.
3. **Visually verify** UI/rendering fixes via screenshot — green text-level tests are NOT sufficient evidence for visual bugs.
4. If the fix breaks an adjacent test, that's a root-cause signal — re-diagnose instead of patching the other test.

### Three test tiers — pick by bug class (`docs/plans/20260623-real-engine-playtest-harness.md`)

Choosing the wrong tier is how bugs pass 2630 green unit tests yet break the real game (combat not firing, «Новая игра» not resetting, the hex-removal save-crash). Route every regression by what actually broke:

| Tier | Where | Catches | When to use |
|------|-------|---------|-------------|
| **Unit (mocked logic)** | `src/tests/**/*.test.ts` with `Mock*` services / `vi.mock("pixi.js")` | pure logic in isolation | a **pure function / domain rule** is wrong (math, state machine, validation) |
| **Real-engine playtest (integration behaviour)** | `src/tests/playtest/**` — boots the **real** `GameEngine` + real `GalaxyService`/`QuestManager`/`BankingService`, stubs only PixiJS, asserts observable state **+ zero logged/thrown errors** | **wiring between real components** (scene transitions, combat module, quest completion, banking bus, new-game reset) | an **integration/scene/wiring** bug — the seam between systems, not the logic inside one |
| **Playwright E2E (rendered/visual)** | `e2e/**` (`playtest-regression.spec.ts`) | real rendering + pointer interaction the headless harness can't see | a **visual/interaction** bug (layout, hit geometry, what's actually drawn) |

**Convention:** an integration/scene bug's regression goes in the **real-engine playtest harness** (behaviour over the real system) — **never** a mocked unit test that re-creates the false green by mocking the very seam that broke. Unit tests stay for pure logic only. The playtest suite (`npm run test:playtest`, ~3 s) is a **pre-push gate** (`lefthook.yml`), so ralphex validates its own fixes against the real flow inside its loop.

### Letsplay engine — an agent plays as the player (dev-only)

`src/tests/playtest/letsplay/` is an **agent that plays the game as the player** on the *real* `GameEngine` (built on `RealEngineHarness`) for automated bug discovery between feature batches (`docs/architecture/LETSPLAY_ENGINE.md`, `docs/plans/20260625-dev-letsplay-engine.md`). The loop is `observe → decide → apply → tick`: `observe(engine)` projects the live engine into a pure `Observation` (scene, vitals, nearby planets/stations/NPCs, active quests, and the **set of legal actions** for the scene); a pluggable `PlayerPolicy.decide(obs) → Action` chooses a **legal** action (the `HeuristicPolicy` ranks `survive → earn → explore`); `PlayerAgent` applies it onto the real engine through the harness. `npm run letsplay` plays K sessions × N steps via vitest (dev-only, like `test:playtest`) and exits non-zero on any harness-sink error or always-actionable-invariant breach. The action vocabulary order (`ACTION_ORDER` in `observe.ts`, `wait` always legal) is the single source of truth shared by the legal-action surface and the future net's output head.

- **Partial observability + per-run memory (the POMDP design)** (`docs/plans/20260625-agent-memory-partial-observability.md`). `observe` is **egocentric**: it exposes only what the player can perceive *now* — market prices appear solely on the *landed* `currentPlanet`, never on an unvisited one. To play like a human the agent therefore carries a **per-run, structured belief** (`AgentMemory`: a `priceBook`, FIFO buy-price `inventoryLots`, a `threatMap`, and `knownOffers`); `PlayerAgent` folds each observation into it with `updateMemory` **before** deciding and passes `{obs, memory}` to the policy (reset fresh each game). The belief is summarised into a `MEMORY_FEATURE_LENGTH = 6`-wide block appended after the `OBS_FEATURE_LENGTH = 12` block, so `featurize` and the MLP input are `FEATURE_LENGTH = 18` wide — **growing either block requires retraining + re-exporting the weights JSON** (the lockstep `load()` rejects a width mismatch). `MemoryHeuristicPolicy` reasons over the belief (buy low + remember, return-to-sell where the known margin is best, hold back from a remembered-dangerous goal) and is the behavioural-cloning **teacher**; `knownOffers` is carried but inert until `observe` surfaces shop offers. The net stays small because the memory is **structured state, not weights**.
- **Dev-only is enforced, not just convention.** The engine lives wholly under `src/tests/` (never in `main.ts`'s prod-bundle graph); `src/tests/architecture/letsplayDevOnly.test.ts` asserts **no production module imports it**, and `src/tests/architecture/noOnnxRuntime.test.ts` asserts **no `src/**` module imports `onnxruntime-web`** at all. The pluggable `NeuralPolicy` ("нейросеть думает за игрока") runs a **tiny pure-TS MLP** (`mlp.forward` over a small weights JSON) — no neural runtime, no dynamic `import()`. Until a `*.weights.json` is trained (Post-Completion, offline) and dropped in, it's inert and the agent falls back to the `HeuristicPolicy`, so the prod build is unaffected either way.
- **The oracle gate (`npm run letsplay:ci`)** (`docs/plans/20260625-letsplay-ci-oracle.md`, `docs/architecture/LETSPLAY_ENGINE.md` → "Oracle"). The agent is wired into CI as a **regression + balance oracle**: it runs as the `letsplay-ci` **pre-push** command (`lefthook.yml`, after `playtest`) and a dedicated **CI workflow** (`.github/workflows/letsplay-ci.yml`). The script plays `K` seeded sessions (`ci.run.ts` → the pure `sessionMetrics` evaluator) **and** runs the static **oddity** assertions in `src/tests/oddities/` (`balanceInvariants`/`assetCoverage`/`visualVariety` — no strictly-dominated gear, no dead stat, every prod `pickVariant` prefix resolves to ≥1 asset, ≥3 star types / ≥2 variants per family). Hard faults (crash / soft-lock / corrupt vital) gate at a hard **zero**; the **balance bands** (credits/day, days-to-upgrade, survival) are deliberately **measured-empty and unscored** today (the heuristic never advances a galaxy day at the headless budget) — a zero-session run still reds the gate, and the rebaseline procedure lives in `DEFAULT_CI_THRESHOLDS` + `LETSPLAY_ENGINE.md`. `src/tests/oddities/` is the home for new static balance/asset/visual invariants.
- **Watch it fly the *live* game — the autopilot (dev-only)** (`docs/plans/20260625-dev-autopilot.md`, `docs/architecture/LETSPLAY_ENGINE.md` → "Autopilot"). The same agent core also drives the *rendered* game in `npm run dev`: press `` ` `` (Backquote) or call `window.__autopilot.start()/.stop()/.toggle()` to hand the live ship to `selectPlayerPolicy()` (heuristic by default). `AutopilotController` runs `observe → policy.decide → applyLiveAction` over the live `SpaceFlightScene`/`GameEngine` on a timer (default 800 ms/tick, "● АВТОПИЛОТ" pill); the **first** real pointer/key reclaims control. The brain + live applier (`LiveApplier`/`AutopilotController`/`installAutopilotHook`) live under `src/tests/`, reusing the headless agent's live-engine query helpers (`engineQueries.ts` — the **single source of truth** shared with `PlayerAgent`); the lone prod seam `src/dev/devAutopilot.ts` is a pure injectable gate attached via a **DEV-gated dynamic `import()`** in `main.ts`, so Vite drops the dev chunk from the prod bundle (guarded by `letsplayDevOnly.test.ts`). It's the preferred way to eyeball **visual oddities** (suns / missing art / sameness) the headless agent can't see.

## Equipment System: ShipLoadout is Canonical

**`GearCatalog`/`ShipLoadout` is the single source of truth** for the hull and every derived stat (cargo, slots, weapon damage, speed, HP). The dual-hull unification (`docs/plans/20260616-dual-hull-unification.md`, save **v22→23**) removed the legacy `PlayerShip.modules` 3-slot array, the `HULL_CLASS_SPECS`-backed stat getters, `equipModule`/`unequipModule`, `GameEngine.rehydrateModule`, the `syncShipToHullClass` bridge, and the dead `IEquipmentService` port. All three former feeding flows (combat loot, gear purchases, micromodule crafting) and the `StationScene` hangar panel now read/write the loadout.

- **Slots are category-aware, not a flat total** (`docs/plans/20260616-ship-fitting-hangar-rework.md`). `ShipLoadout.canInstall`/`install` resolve each gear to one of four banks via `slotCategoryFor(gear)`: weapon (`hull.weaponSlots`), equipment (`hull.equipmentSlots`, shared by fuel tank/shield/droid/scanner/grav-tractor/grapple), engine (1), radar (1). Engine and radar are single dedicated slots — installing a new one **replaces** the fitted part (drops it) rather than stacking or rejecting; the displaced id is surfaced by `loadout.displacedBy(gearId)` so install callers (`installOwnedGear`, `StationScene.buyItem`, combat loot) **re-home it** (warehouse/bag) instead of destroying it. `derivedStats().categories` reports `{used,total}` per bank. The flat `slotsTotal`/`slotsUsed` (still `hull.slots`/`slotted.length`) are legacy and can read `used > total` on a fully-fitted hull — prefer `categories`.
- **Mass budget (МАССА/СВОБОДНО) is a second capacity gate.** Each gear carries `mass` (catalog data on `GearBase`); installed mass sums against `HullSpec.massCapacity`, and `canInstall` rejects an over-mass install **even if a category slot is free** (an engine/radar swap credits the displaced part's mass first). The hull's own frame mass is not counted. `derivedStats()` exposes `massUsed`/`massCapacity`/`massFree`. Mass is catalog-derived from gear ids, so there is **no save migration** (`schemas.ts` untouched).
- **`gearFit(loadout, gearId)`** in `GearBridge` is the canonical structured projection of `canInstall` (`fits` / `no-slot` / `over-mass` / `n/a`) — both the EquipmentShop per-listing hint and `StationScene.explainInstallBlock`'s install-block toast read it; do **not** re-derive fit logic.
- The live `PlayerShip` carries only its in-combat HP/shield/energy pools + a `hullClass` label; these are projected from the loadout via `applyLoadoutHullToShip(ship, loadout)` at hull-change time (both hull shops call it after `loadout.setHull(...)`). Cargo capacity is read through `cargoCapacityOf(loadout)` — no per-ship fallback.
- Hull swaps go through `ShipLoadout.setHull`, which **returns the gear ids it dropped** (gear that no longer fits a smaller hull); callers return those to the inventory bag rather than destroying them. Hangar slot edits use the slot-indexed `removeAt`/`applyMicromoduleAt` (not the by-id variants) so the exact clicked copy is targeted with duplicate gear fitted.
- **Owned-but-uninstalled gear** has a canonical home: `Inventory.ownedGearIds` (catalog gear ids), read **only** through `ownedUninstalledGear(player, loadout)` in `GearBridge` — which returns the store verbatim (it never subtracts installed ids, so an owned *spare* of fitted gear stays sellable). Transitions: `acquireUninstalledGear` (a purchase/loot with no free slot), `installOwnedGear` (owned → loadout), `uninstallToOwned` (loadout → owned). Both the StationScene hangar ТРЮМ and the EquipmentShop ТРЮМ strip consume this one accessor; selling goes through `sellUninstalledGear` (`src/systems/equipment/sellGear.ts`, refund `basePrice × 0.4`). Persisted via `InventorySchema.ownedGearIds` (defaults `[]` for old saves — no save-version bump).
- **Hull micromodule slots are a third capacity gate** (`docs/plans/20260619-equipment-install-and-micromodule-overhaul.md`, save **v24→26**). Each hull exposes `HullSpec.micromoduleSlots` (1–4; `DEFAULT_HULL_MICROMODULE_SLOTS` fallback) bounding `ShipLoadout.hullMicromoduleIds: string[]` (replaces the former single `hullMicromoduleId`; a hull swap clears them). Hull micromodules are a **separate** catalog family `HULL_MICRO_MODULES` (`ModuleCategory.HULL`), kept apart from the 4-category `MICRO_MODULES` so the locked `micromodule.test.ts` count/category asserts stay green. `hullMicromoduleEffectKind` classifies each: defense→maxHull, cargo→hold, energyWeapon→weapon damage, energyEngine→engine speed — applied as a **global** multiplier in `derivedStats()` (canon: improve weapon/engine without a module fitted on them); unknown/legacy ids default to `defense`. `MicroModuleSchema.targetCategory` **must** include `"HULL"` — these objects persist verbatim into `inventory.micromodules`, so omitting it bricks any save made while one is owned.
- **Shop/trade-in seams (single source of truth):** `micromoduleShop.ts` (`micromoduleShopCatalog`/`micromodulePrice`/`buyMicromodule`) is the only purchase path for science-station (CRAFT_CENTER) micromodules — shared by `StationScene` UI + tests, posting a balanced player→`gl:equipment` transfer. `sellHull.ts` (`hullTradeInPrice` = `floor(basePrice × 0.4)`, `buyHullWithTradeIn`) is the EquipmentShop hull trade-in path (charge new hull + credit old, both balanced bus postings; never hull-less). Drag-drop fitting is decided purely in `GearBridge` (`evaluateMicromoduleDrop`/`applyMicromoduleDrop`/`micromoduleDropHint` + `micromoduleTargetCategory`) — the apply methods don't re-check category, so this gate is load-bearing. **Note:** the micromodule-fitting surface now lives in the shared `HangarPanel` (its per-slot drag-drop zones + the shared `MicromoduleApplyPanel` modal), so **both** `StationScene` and the planet Верфь (`EquipmentShopScene` АНГАР tab) fit micromodules through the identical flow.
- **Ready-to-fly starter + one shared hangar + multi-weapon fire** (`docs/plans/20260623-combat-multiweapon-starter-loadout-shared-hangar.md`). `GameEngine.starterLoadout()` ships a fresh corvette **fully fitted** — `eq_engine_i` (engine) + `eq_tank` + `wpn_pulse` (weapon) + `grav_tractor_1` (the grapple/захват, EQUIPMENT bank) — with **nothing install-required loose in the hold** (empty `inventory.modules`/`ownedGearIds`); fitted mass 6+3+4+3 = 16 ≤ 40. The slot-fitting hangar is a single presentation component `src/presentation/ui/HangarPanel.ts` (four category banks + install/unfit + the ТРЮМ owned-gear strip, all mutating the canonical `ShipLoadout` through the shared gear helpers — no forked fit logic) mounted by **both** `StationScene` and the `EquipmentShopScene` **АНГАР tab**, so fitting looks/behaves identically at either entry point; the per-slot micromodule-apply modal is the shared `MicromoduleApplyPanel` (opened from a fitted slot, identical in both scenes). Real-time combat (`CombatModule`) now fires **every** fitted weapon (`fittedWeapons()`), each on its own `weaponFireTimers` cadence — derived **per-weapon from `cooldownTurns`** via `weaponFireIntervalMs(weapon)` = `max(1, cooldownTurns) × GAME_BALANCE.combatFireIntervalMs`, so a slow `cooldownTurns:3` beam fires ~⅓ as often as a quick pulse (cadence is a real tradeoff vs. per-shot `damage`) — at the nearest combatant **within that weapon's own `range`** (selected target preferred; a weapon with nothing in range holds) — not just the single `selectedWeapon`. Each engaged NPC returns fire from **its own role-scaled reach** (`npcWeaponRange`, `src/systems/combat/npcWeapon.ts`: TRADER 200 / PIRATE 260 / RANGER 300 / PATROL 340, role-derived → no schema/migration), not the legacy flat `GAME_BALANCE.weaponRange` 240 — so a long-range player weapon (railgun 360) can't trivially out-range *every* foe. The active-pause «Огонь!» (`confirmAttack`) stays the deliberate single-shot path.
- **Residual (partially removed):** `ownedGearIds` is now fed by the buy-without-a-free-slot path **plus** old-save migration v24→25 (drains mappable `inventory.modules` entries into `ownedGearIds`). (The new-game starter no longer seeds any loose gear — `starterLoadout()` ships a fully-fitted corvette with an empty hold — so `convertLegacyBagToOwnedGear` in `GearBridge`, which drained the old starter bag, is now exercised only by tests / legacy-save paths and is **not** called from `GameEngine`.) `uninstallToOwned` exists in `GearBridge` but is **not currently wired to a UI** — both scenes' hangar **unequip** now flows through the shared `HangarPanel` into the legacy `inventory.modules` bag via `slotToBagModule` (which preserves the slot's micromodule + artifact-upgrade count — `ownedGearIds` is a bare id list that cannot). Combat loot (the in-flight loot drop in `NpcShipManager.handleInFlightDeath` → `spawnLootForNpc`) routes the same way. The bag is also a purchase/remove fallback, and `PlayerShipSchema.modules` stays `.optional()` so pre-v23 saves validate. Remaining cleanup: give `ownedGearIds` rich entries (id + micromodule + upgrades), migrate loot + hangar-unequip onto it, and retire the bag.

## Before Every Code Change: Blast Radius Analysis

Before touching any file, run this sequence — no exceptions, no skipping for "small" changes:

1. **`gitnexus impact <Symbol>`** — get the blast radius: which callers, scenes, and tests directly depend on the symbol being changed.
2. **`gitnexus detect_changes`** — if already on a branch with edits, see what's already affected.
3. **`vacuum find_symbol <Symbol>`** — read the full body of what you're about to change.

Then apply the **Pareto filter**: from the blast radius, identify the 20% of touch-points that carry 80% of the risk. Change only those. Leave low-risk dependents untouched unless a test goes red.

**Concrete checklist before each edit:**
- [ ] Blast radius confirmed (impact tool or manual grep)
- [ ] Identified the minimal set of files that must change
- [ ] All other callers verified they don't need updating (or noted why)
- [ ] No refactor bundled into a bug fix — one concern per commit

This rule exists because cascade failures in this codebase typically come from changing a shared utility (e.g. `QuestManager`, `CombatModule`, `GameEngine`) without checking what scenes and systems call it.

## Tooling

Dev helpers (details in `tools/README.md`):
- `vacuum` MCP — `find_symbol`/`find_tests_for`/`get_architecture` — instant body lookup, no index needed
- `gitnexus` MCP — `impact`/`detect_changes`/`context`/`query` — dependency graph, blast radius, semantic search (requires `.gitnexus/` index; re-run `npx gitnexus analyze` after large merges)
- `scaffold/domain-field.ts` — add a field across lockstep files
- `scaffold/new-scene.ts` — register a scene across all 5 files

@.claude/docs/adding-features.md

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **SpaceRangersOnline** (10075 symbols, 35340 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/SpaceRangersOnline/context` | Codebase overview, check index freshness |
| `gitnexus://repo/SpaceRangersOnline/clusters` | All functional areas |
| `gitnexus://repo/SpaceRangersOnline/processes` | All execution flows |
| `gitnexus://repo/SpaceRangersOnline/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
