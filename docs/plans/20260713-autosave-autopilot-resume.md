# Player-Facing Autosave + Dev-Autopilot Resume

## Overview

Today the dev-only live autopilot (backtick-toggle in `npm run dev`) is pure in-memory state:
`AutopilotController.engaged` lives only in the running tab. The game already autosaves on every
scene transition (`GameEngine.transitionTo()` → `saveGame("auto")`), but a reload or a later
"Продолжить" never re-engages the autopilot even if it was actively flying when the autosave was
written — the player (or, more precisely, whoever left the tab running the autopilot) has to
manually press `` ` `` again after every reload.

This plan adds one small piece of persisted state — "was the autopilot engaged at save time" — and
wires the boot/continue path to read it back and re-start the autopilot automatically, without
letting a DEV-only concern leak into the production bundle or into `GameEngine`'s own layer.

**Not in scope**: this is unrelated to `docs/plans/completed/completed/20260713-campaign-win-rate-architecture.md`
(campaign win-rate tuning) and to the separate flight-jitter investigation running in parallel —
touches different files, no shared risk.

## Context (from discovery)

- **Autosave trigger**: `GameEngine.ts` `transitionTo()` calls `this.saveGame("auto")` at `:769` on
  every scene transition (gated: has `galaxy`+`player`, not `MAIN_MENU`/`RACE_SELECTION`/`GAME_OVER`).
  `saveGame(slotId = "auto")` builds the `SaveState` at `:1213-1230`, writes via
  `saveManager.write(slotId, state)` (`:1232`). `loadGame(slotId = "auto")` at `:1235`. Boot
  auto-load at `:547-552` (`hasSave` → `loadGame("auto")`).
- **Continue flow**: `continueGame()` (`GameEngine.ts:1461-1465`) → `latestMeaningfulSlot(saveManager)`
  (`src/systems/saves/saveSlots.ts:220-236`, most recent non-terminal-scene save across slots) →
  `loadGame(slotId)`.
- **Autopilot engagement state**: `AutopilotController.engaged` (private bool) + `get isEngaged()`
  (`src/tests/playtest/letsplay/AutopilotController.ts:211,246-248`). `start()` (`:280-297`), `stop()`
  (`:304-316`), both idempotent. `window.__autopilot` hook (`installAutopilotHook.ts:849-883`)
  exposes an `engaged` getter + `start/stop/toggle`, built by `installAutopilotHook(engine, overrides)`
  (`:790-883`), which needs only the already-installed `engine` reference (closed over at install
  time) — `start()` takes no per-call engine arg.
- **DEV-only gating**: `src/dev/devAutopilot.ts` `attachDevAutopilot(isDev, engine, load, onError)`
  no-ops if `!isDev`. Wired from `src/main.ts:202-209` inside `if (import.meta.env.DEV)`, with a
  dynamic `import('./tests/playtest/letsplay/installAutopilotHook')` so Vite/Rollup DCEs the whole
  dev chunk from prod. Enforced by `src/tests/architecture/letsplayDevOnly.test.ts` (no production
  module imports the letsplay engine tree) and `noOnnxRuntime.test.ts`. **`GameEngine.ts` (production
  code in `src/systems/`) must never directly import anything under `src/tests/playtest/letsplay/`.**
- **SaveState additive-optional-field precedent**: `src/domain/SaveState.ts` `campaignPeakPower?: number`
  (`:48-54`, threaded through constructor/`serialize()`:63-81/`deserialize()`:83-99) and
  `loadoutPresets?` (`:55-60`) are the exact pattern to mirror for `autopilotEngaged?: boolean` — no
  migration, no `CURRENT_VERSION` bump (per root `CLAUDE.md`'s "optional additive field" exception:
  absent ⇒ a natural default, not a value that must be defaulted to something other than "absent").
  `src/validation/schemas.ts` `SaveStateSchema` (~`:600-627`) needs the sibling Zod field, e.g.
  `campaignPeakPower: z.number().min(0).max(1).optional()` at `:622` is the shape to copy.
- **Layer-violation precedent**: root `CLAUDE.md`'s "Fixing a `systems/` → `presentation/` layer
  violation" note (narrow port in `src/core/ports/`, optional DI, headless no-op adapter in
  `src/core/adapters/` — see `IOverlayPresenter`/`OverlayPresenter`/`NoOpOverlayPresenter`) is the
  established pattern for exactly this shape of problem, here applied to `systems/` →
  dev-only-test-tree instead of `systems/` → `presentation/`.
- **Existing tests to extend**: `src/tests/systems/saveSlots.test.ts` (346 lines),
  `src/tests/presentation/saveLoadScene.test.ts`, `src/tests/playtest/letsplay/AutopilotController.test.ts`
  (649 lines), `src/tests/playtest/letsplay/installAutopilotHook.test.ts` (1081 lines). No dedicated
  `GameEngine` save/load round-trip test file was found under `src/tests/systems/GameEngine*.test.ts`
  / `src/tests/core/GameEngine*.test.ts` — confirm during Task 1 where round-trip coverage for new
  `SaveState` fields currently lives (likely alongside `campaignPeakPower`'s own test) and extend
  that, rather than inventing a new file.
- **Uncommitted WIP note**: the working tree currently has substantial uncommitted (but fully green,
  590 files / 5492 tests) changes to `GameEngine.ts`, `AutopilotController.ts`, `installAutopilotHook.ts`,
  `LiveApplier.ts`, `MemoryHeuristicPolicy.ts` from prior live-autopilot reliability work
  (`docs/plans/completed/20260711-parallel-workstream-boundaries.md`,
  `docs/plans/completed/20260712-autopilot-live-tick-symptoms.md`). This plan builds directly on top
  of that tree state — do not revert or stash it.

## Development Approach

- **Testing approach**: mostly TDD for the new `SaveState` field, schema, and DI seam (pure/isolated
  code, straightforward to red-green). The actual "autopilot resumes after continue" end-to-end
  behavior needs the **real-engine playtest tier** (`src/tests/playtest/**`), not a mocked unit test
  that just re-mocks the seam and proves nothing about real boot wiring — per this project's
  three-tier testing convention (`CLAUDE.md` "Bug Fixing Process" section), even though this is a
  feature, not a bug fix.
- Complete each task fully before moving to the next.
- Make small, focused changes — no refactor bundled into this feature.
- **CRITICAL: every task that touches production code MUST include new/updated tests.**
- **CRITICAL: all tests must pass before starting the next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- **PRIMARY: never modify/weaken/delete an existing test assertion** — new tests only; if a change
  reds an existing test, stop and ask.
- Per root `CLAUDE.md`'s blast-radius rule: run `gitnexus impact` on `AutopilotController`,
  `installAutopilotHook`, `GameEngine.saveGame`/`loadGame`/`continueGame`, and `SaveState` before
  editing each; report risk before proceeding. Use `vacuum find_symbol` before `Read`-ing whole files
  for a narrow symbol lookup.
- Errors: only `GameBusinessException`/`GameSystemException`/`GameValidationException`/
  `InferenceException`; `src/utils/logger.ts`, never `console.log`.

## Testing Strategy

- **Unit tests**: `SaveState` field (constructor/serialize/deserialize round-trip), `SaveStateSchema`
  Zod validation (present/absent/wrong-type), the new DI port's no-op adapter, `AutopilotController`
  start/stop already-covered paths extended only where the new wiring touches them.
- **Real-engine playtest**: a new (or extended) test under `src/tests/playtest/` that boots a real
  `GameEngine`, engages the autopilot, saves, constructs a **fresh** `GameEngine` (simulating
  reload), loads, and asserts the autopilot auto-resumed — this is the only tier that can actually
  prove the boot-sequencing risk (Task 1) doesn't silently no-op.
- `npm run letsplay:ci` and `npm run test:playtest` must stay green throughout (wiring must not
  regress existing autopilot behavior).
- `letsplayDevOnly.test.ts` / `noOnnxRuntime.test.ts` must stay green — production bundle must never
  reference the letsplay tree unconditionally.
- No E2E needed unless Task 1 decides on a visible resume notice (UI surface) — if so, add a small
  Playwright check per the project's "UI changes → e2e in the same task" rule.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update this plan if implementation deviates from original scope.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): the DI seam, the `SaveState` field, the boot/continue
  resume wiring, and all tests up to full acceptance.
- **Post-Completion** (no checkboxes): manual live-browser verification (close tab mid-autopilot-flight,
  reopen, confirm resume) since headless tests can't observe the real backtick-hotkey/DOM path.

## Implementation Steps

### Task 1: Confirm scope — boot sequencing, resume UX, and the DI seam shape

- [x] Run `gitnexus impact` on `AutopilotController`, `installAutopilotHook`, `attachDevAutopilot`,
      `GameEngine.saveGame`/`loadGame`/`continueGame`/`initialize`, and `SaveState`; report risk.
      **Reported (upstream, `repo: vacuum-rogues`):**
      - `AutopilotController` (class, dev tree): 0 upstream, **LOW** — no production dependents (as expected).
      - `installAutopilotHook` (dev tree): 0 upstream, **LOW**.
      - `GameEngine.saveGame`: 0 direct upstream, **LOW** (called internally on scene transitions).
      - `GameEngine.continueGame`: 1 upstream (`MainMenuScene.handleContinue`), **LOW**.
      - `GameEngine.loadGame`: 13 impacted / 5 direct, **CRITICAL** — hub method feeding boot
        `initialize`, `handleContinue`, `SaveLoadScene.renderRow`, `SpaceFlightScene`. ⚠️ The
        resume seam must be **purely additive** at the end of `loadGame` (record the loaded flag +
        one optional injected call); no change to existing load control flow, or these 4 processes
        break. Adding a field read/write, not re-routing, keeps risk contained.
      - `SaveState` (class): 45 impacted / 10 direct, **MEDIUM** — expected for an additive field;
        the additive-optional precedent (`campaignPeakPower`) already threads all 10 direct sites,
        so the new field follows the same shape with no new call-site edits beyond the mirror.
- [x] Trace the **actual** boot sequence in `main.ts` and `GameEngine.initialize()`.
      **Confirmed ordering:** `main.ts` calls `engine.initialize(...)` (`:184`) which runs the boot
      auto-load `loadGame("auto")` (`GameEngine.ts:552`) **and starts the game loop, then returns** —
      all *before* `attachDevAutopilot` (`main.ts:202-209`) runs. `attachDevAutopilot` then does a
      **dynamic `import()`** of `installAutopilotHook`, so the hook is installed **strictly after**
      the boot auto-load has already completed. `continueGame()` is a **later, user-triggered** call
      (`MainMenuScene.handleContinue`) that only fires once the player is sitting at the main menu —
      by then the hook is already installed. **Consequence (the core sequencing finding):** the two
      load paths are asymmetric — at **boot** the save is loaded *before the autopilot hook exists*,
      so a resume call from inside `loadGame` would hit a not-yet-installed hook and silently no-op;
      at **continue** the hook is already present. Therefore the design needs **two seams**: (a) a
      plain boot-safe getter that caches the loaded flag so the DEV wiring can *catch up* right after
      it installs the hook, and (b) an optional injected `resume(engaged)` call at the end of
      `loadGame` that covers `continueGame` (and any in-game slot load) where the hook already exists.
- [x] Decide silent vs notice. **Decision: silent resume.** This is a dev-only convenience; the
      `escalationNotices.ts` one-shot-news pattern is for narrative Overmind escalation, not dev
      tooling — reusing it here is over-engineering. **Confirmed a HUD indicator already exists:** the
      `● АВТОПИЛОТ` pill (`domIndicator()` in `AutopilotController.ts`, DOM id `autopilot-indicator`,
      referenced by `flashFlaggedIndicator` at `installAutopilotHook.ts:88`) is shown live whenever
      the autopilot is engaged. So calling `start()` on resume makes engagement immediately
      discoverable through the existing pill — no separate notice is needed.
- [x] Design the DI seam signature. **Confirmed shape (autopilot-agnostic, no letsplay import in
      `GameEngine`):**
      - Port `IAutopilotStateProvider` (`src/core/ports/IAutopilotStateProvider.ts`):
        `isEngaged(): boolean` (read at save time) + `resume(engaged: boolean): void` (called at the
        end of `loadGame`; the dev impl re-engages when `engaged` is `true`, no-op otherwise).
      - `NoOpAutopilotStateProvider` (`src/core/adapters/`) — `isEngaged()→false`, `resume()→{}`;
        the default so all legacy DI sites stay byte-identical (mirrors `NoOpOverlayPresenter`).
      - `GameEngine`: holds the optional provider (default no-op) plus a **setter**
        `setAutopilotStateProvider(p)` so the DEV wiring can inject the real provider *after* it
        installs the hook (construction happens before the hook exists — see the boot finding). It
        also records the last-loaded flag and exposes a plain getter
        `getLoadedAutopilotEngaged(): boolean | undefined` — the **boot catch-up seam**.
      - **Boot path**: `attachDevAutopilot`, after `installAutopilotHook`, (a) injects the real
        provider via `setAutopilotStateProvider`, then (b) reads `engine.getLoadedAutopilotEngaged()`
        once and calls `start()` if it was `true` — catches the boot auto-load that ran before install.
      - **Continue / in-game load path**: `loadGame` calls `this.autopilotState.resume(save.autopilotEngaged ?? false)`
        at its tail; by then the real provider is injected, so resume fires normally.
      This keeps `GameEngine` fully autopilot-agnostic (it only ever calls the injected optional
      provider + exposes a boolean getter, never importing the `src/tests/playtest/letsplay/` tree).
      No code changes in this task — confirmation only.

### Task 2: Add the `IAutopilotStateProvider` port + no-op adapter

- [x] Add the port interface to `src/core/ports/` per Task 1's confirmed shape.
      (`src/core/ports/IAutopilotStateProvider.ts` — `isEngaged()` + `resume(engaged)`.)
- [x] Add `NoOpAutopilotStateProvider` to `src/core/adapters/` (mirrors `NoOpOverlayPresenter`) —
      `isEngaged()` always returns `false`; the resume-hook side is a no-op.
- [x] Wire the optional dependency into `GameEngine`'s constructor/DI (default to the no-op adapter
      when absent, exactly like `IOverlayPresenter`) — legacy DI sites stay byte-identical.
      Added `GameEngineDIDependencies.autopilotStateProvider?`, the private `autopilotState` field
      (defaults to `NoOpAutopilotStateProvider`), the `setAutopilotStateProvider()` post-boot
      injection setter, the `getLoadedAutopilotEngaged()` boot-catch-up getter + backing
      `loadedAutopilotEngaged` field, and the `loadGame`-tail `autopilotState.resume(...)` wiring
      (inert no-op until Tasks 3/4 populate the loaded flag).
- [x] Write tests: no-op adapter behavior, `GameEngine` falls back to it when the port isn't injected.
      (`src/tests/core/autopilotStateProvider.test.ts` — 5 tests, all green.)
- [x] Run affected unit tests — must pass before Task 3. (autopilotStateProvider + GameEngine.di +
      overlayPresenter + gameEngineContinue: 40 passed; `tsc --noEmit` clean; targeted eslint clean.)

### Task 3: Add `SaveState.autopilotEngaged` field + schema + save-time read

- [x] Add `autopilotEngaged?: boolean` to `src/domain/SaveState.ts` (constructor param, `serialize()`,
      `deserialize()`) mirroring `campaignPeakPower`'s exact additive-optional shape.
      (Added as the last constructor param; threaded through `serialize()`/`deserialize()`.
      `SerializedSave.payload` is a JSON string so no `src/types/index.ts` change was needed.)
- [x] Add the sibling Zod field to `SaveStateSchema` in `src/validation/schemas.ts`
      (`autopilotEngaged: z.boolean().optional()`).
- [x] In `GameEngine.saveGame()` (`:1213-1230`), read the Task 2 port and set it on the built
      `SaveState`. (Field is `this.autopilotState` — passes `this.autopilotState.isEngaged()`; inert
      `false` under the default `NoOpAutopilotStateProvider` in production/tests.)
- [x] Write tests: `SaveState` round-trip (present `true`/`false`/absent), schema validation
      (accepts boolean, accepts absent, rejects wrong type), `saveGame` writes the provider's current
      value into the built state (unit test with a stub provider).
      (`src/tests/core/saveStateAutopilotEngaged.test.ts` — 9 tests, all green.)
- [x] Run affected unit tests — must pass before Task 4. (saveStateAutopilotEngaged +
      autopilotStateProvider + GameEngine.flight-position + playerPower: 44 passed; goldenSaveCompat +
      saveMigration: 18 passed; `tsc --noEmit` clean; targeted eslint clean.)

### Task 4: Wire boot/continue resume

- [ ] Implement Task 1's confirmed resume seam: after a save with `autopilotEngaged === true` is
      loaded (boot auto-load path AND `continueGame()` path — both must be covered, they may differ
      per Task 1's sequencing finding), the DEV-only wiring in `src/dev/devAutopilot.ts` calls the
      installed `AutopilotController.start()` (via `window.__autopilot.start()` or a direct reference
      captured at install time — whichever `installAutopilotHook`'s existing shape supports without
      a new public surface).
      **Do not change `GameEngine`'s own behavior for the non-DEV production path** — the resume
      call must only ever be reachable through the existing `if (import.meta.env.DEV)` chunk.
- [ ] Write tests: extend `AutopilotController.test.ts`/`installAutopilotHook.test.ts` for the new
      resume trigger in isolation (given `autopilotEngaged: true` was loaded, `start()` is called;
      given `false`/absent, it is not).
- [ ] Write the real-engine playtest (Testing Strategy) proving the full loop: engage → autosave →
      fresh engine → load → resumed. This is the task that actually validates Task 1's sequencing
      decision was correct, not just internally consistent.
- [ ] Run `npm run letsplay:ci`, `npm run test:playtest`, `letsplayDevOnly.test.ts`,
      `noOnnxRuntime.test.ts` — all must stay green.
- [ ] Run affected unit tests — must pass before Task 5.

### Task 5: [Final] Verify acceptance criteria and update documentation

- [ ] Verify: engaging autopilot live, triggering an autosave (any scene transition), simulating a
      fresh-engine reload+continue, resumes the autopilot automatically — proven by Task 4's
      real-engine playtest, not just unit tests.
- [ ] Verify a save with the autopilot OFF does not spuriously start it on continue.
- [ ] Verify a save with `autopilotEngaged` absent (old save, pre-this-plan) loads exactly as today
      (no autopilot, no crash) — the additive-optional-field default-safe path.
- [ ] Run full unit suite, `tsc --noEmit`, `npm run lint`, `npm run test:playtest`,
      `npm run letsplay:ci`, `npm run test:save-compat` — all must be green.
- [ ] Update `.claude/docs/systems/letsplay.md`'s "Live autopilot" section with the new
      resume-on-continue behavior (one short paragraph, matching the doc's existing style).
- [ ] Update `.claude/docs/systems/save-slots.md` if the new field is worth a one-line mention
      (likely yes, since it's a new `SaveState` field consumers of that doc should know exists).
- [ ] Record final DI seam shape and any deviations from Task 1's design in this plan's Technical
      Details section.

## Technical Details

- **Additive field**: `SaveState.autopilotEngaged?: boolean`, absent ⇒ `false`/no resume — no
  migration, no `CURRENT_VERSION` bump, no golden-save regeneration needed (per `CLAUDE.md`'s
  additive-optional-field exception).
- **DI seam** (confirmed in Task 1): `IAutopilotStateProvider` (`src/core/ports/`) with
  `isEngaged(): boolean` (read at save time) + `resume(engaged: boolean): void` (called at the tail
  of `loadGame`). Optional dependency on `GameEngine`, `NoOpAutopilotStateProvider`
  (`src/core/adapters/`) default — mirrors the `IOverlayPresenter` pattern named in root `CLAUDE.md`
  exactly, applied to a `systems/` → dev-only-tree boundary instead of `systems/` → `presentation/`.
  Because `GameEngine` is constructed **before** the autopilot hook exists (boot auto-load runs
  first), the real provider is injected post-install via a `setAutopilotStateProvider(p)` setter, and
  a boot-safe getter `getLoadedAutopilotEngaged(): boolean | undefined` lets the DEV wiring catch up
  on the one boot auto-load that resolved before the hook was installed. See Task 1's design entry
  for the full boot-vs-continue asymmetry rationale.
- **DEV-only boundary preserved**: `GameEngine.ts` never imports anything under
  `src/tests/playtest/letsplay/` — the only concrete `IAutopilotStateProvider` implementation (backed
  by the real `AutopilotController`) is constructed and injected from `src/dev/devAutopilot.ts`,
  which is itself only reachable through `main.ts`'s `if (import.meta.env.DEV)` dynamic-import chunk.

## Post-Completion

**Live-browser manual verification** (informational, cannot be headlessly proven beyond the
real-engine playtest): open `npm run dev`, press `` ` `` to engage autopilot, let it fly to trigger
at least one scene-transition autosave, close the tab (or hard-reload), reopen, and confirm the
autopilot resumes without pressing `` ` `` again — and that manual input still reclaims control
exactly as before.
