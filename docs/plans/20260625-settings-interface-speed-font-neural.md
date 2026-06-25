---
# Settings Interface (Speed, Font, Neural Toggle + Lazy/Gated ONNX)

## Overview
Build a proper **settings interface** and surface three controls in it:
**game speed**, **font size**, and a **neural-AI on/off toggle**. Today these are
scattered (speed on a HUD button + `PlayerSettings.speed`; font as a standalone
`localStorage("fontScale")` S/M/L; a minimal "settings panel" stub in `FlightHud`)
and there is no neural switch. The new panel consolidates them into one screen.

Key requirement for the neural toggle: **`onnxruntime-web` must load lazily and only
when the toggle is ON; the toggle is OFF by default.** So a default boot never pulls
the ONNX runtime/worker at all (lean startup), and only an opt-in player loads it —
this is the gate the (deferred) Overmind neural AI will sit behind.

## Context (from discovery)
- **Speed:** `PlayerSettings.speed` (`src/types/index.ts`), applied via
  `ShipPhysics.timeScale` / `GameEngine.gameSpeedMultiplier` (HUD speed button today).
- **Font:** `src/utils/fontScale.ts` — `FONT_SCALES` (S/M/L), `currentFontSizeKey()`,
  `setFontScale()`, persisted to `localStorage("fontScale")`; consumed by
  `scaledFont()` across the UI.
- **Existing settings-panel stub:** `FlightHud` + `SpaceFlightScene` expose
  `isSettingsPanelOpen()`; `flightKeyHandler` already closes the "settings panel" on
  Esc (priority order). The new UI replaces/extends this stub and reuses the
  open/close + Esc wiring.
- **ONNX load path (to gate):** `onnxruntime-web` is imported by
  `src/ai/inference.worker.ts`, `ONNXModelRegistry.ts`, `SimpleONNXModel.ts`;
  `GameEngine` eagerly constructs `onnxRegistry = new ONNXModelRegistry(...)` at boot.
  Gating means **not** constructing the registry / not spawning the worker / not
  importing the runtime unless the neural setting is on.
- **Settings persistence patterns:** browser-level `localStorage` is already used for
  client prefs (`fontScale`, `sr_mobile_ack`, `sr_settings`) — the neural flag follows
  this (no save-state field ⇒ no schema/migration). Speed stays in `PlayerSettings`.

## Development Approach
- **Testing approach: TDD.** The settings store (read/write of speed/font/neural with
  the **neural default = false**) and the **ONNX gate decision** are pure and unit-
  tested first; the panel UI is built against them and screenshot-verified.
- **YAGNI:** reuse the existing `fontScale`/`PlayerSettings.speed` stores; add only the
  `neuralEnabled` localStorage flag. No new save field ⇒ **no schema/migration**.
- The ONNX gate must keep `onnxruntime-web` out of the **eager** boot path: prefer a
  **dynamic `import()`** behind the toggle so the default (off) build never evaluates
  the runtime. `impact` on `GameEngine`'s `onnxRegistry` construction first.

## Testing Strategy
- **Unit:** settings store — `neuralEnabled` defaults **false**, round-trips through
  localStorage; speed/font read+write hit the existing stores; the ONNX-gate predicate
  returns "don't load" when off.
- **Boot test:** with the neural setting off (default), `GameEngine` boot does **not**
  construct the ONNX registry / does not reference the worker (no eager onnxruntime).
- **E2E/screenshot:** the settings panel opens, shows Speed / Font / Neural, changes
  apply live (font rescales, speed changes), and the choices persist across reload.

## Implementation Steps

### Task 1: Settings store (speed + font + neural, neural default off)
**Files:**
- Create: `src/systems/settings/gameSettings.ts`
- Create: `src/tests/systems/gameSettings.test.ts`

- [ ] A small accessor unifying the three: `getSpeed/setSpeed` (→ `PlayerSettings`/
      engine), `getFontKey/setFontKey` (→ `fontScale.ts`), `isNeuralEnabled/
      setNeuralEnabled` (→ `localStorage("neuralEnabled")`, **default `false`**).
- [ ] write tests: neural defaults to false; each setter persists + getter reads back;
      font delegates to `fontScale`, speed to the existing speed store.
- [ ] run tests — green.

### Task 2: Neural feature flag (gates the neural policy; no heavy runtime)
**Files:**
- Modify: `src/systems/settings/gameSettings.ts`; neural-policy entry points
- Create: `src/tests/systems/neuralFlag.test.ts`

> Note: `docs/plans/20260625-pure-ts-mlp-drop-onnx.md` **removes `onnxruntime-web`** —
> the neural net is now a tiny pure-TS MLP that just runs. So there is no heavy runtime
> to lazy-load; the toggle is a plain **feature flag** that enables/disables the neural
> policy (and any future neural feature). Run `pure-ts-mlp-drop-onnx` **before** this plan.

- [ ] Make `isNeuralEnabled()` (default **false**) the single gate consulted before any
      neural policy runs — off ⇒ the rule-based/heuristic path is used and no MLP weights
      are loaded; on ⇒ the pure-TS MLP policy is active.
- [ ] Generalise to a small `featureFlags` accessor so other experimental systems can be
      gated the same way (neural is the first flag).
- [ ] write tests: default off ⇒ heuristic path, no weights loaded; on ⇒ neural policy
      selected; the flag round-trips through localStorage.
- [ ] run tests — green.

### Task 3: Settings panel UI (Speed / Font / Neural)
**Files:**
- Modify/Create: the settings panel (`src/presentation/` — extend the `FlightHud`
  settings stub or a dedicated `SettingsPanel`), `SpaceFlightScene`, `flightKeyHandler`
- Create: `src/tests/presentation/settingsPanel.test.ts`

- [ ] A proper settings panel with: a **Speed** control (the existing speed steps), a
      **Font** S/M/L selector (live `setFontScale` + restyle), and a **Neural AI**
      toggle (off by default; flips `setNeuralEnabled`, lazy-loads/tears down ONNX per
      Task 2, with a hint that it's experimental). Open from the menu/HUD; keep the
      existing Esc-close wiring in `flightKeyHandler`.
- [ ] write tests: the panel reads current settings, each control writes through the
      store + applies live (font rescales via `scaledText`, speed changes
      `timeScale`), the neural toggle calls the gate; panel is keyboard/Esc-closable.
- [ ] run tests — green; **screenshot-verify** the panel.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — settings store +
      GameEngine ONNX gate + the panel UI affected; **no schema/migration** (neural is
      localStorage; speed/font reuse existing stores).
- [ ] full unit suite green; `npm run test:playtest` green; lint clean; build ok;
      confirm default boot loads **no** onnxruntime (gate off) and settings persist
      across reload.

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` / `CLAUDE.md` (ONNX pipeline + settings)

- [ ] Document the settings panel (speed/font/neural), the `neuralEnabled` localStorage
      flag (default off), and that ONNX is now **lazy + gated** by it — onnxruntime is
      not in the default boot path; the (future) Overmind neural AI sits behind this
      toggle.

## Technical Details
- Neural flag = `localStorage("neuralEnabled")`, default `false` ⇒ no save field, no
  migration. ONNX behind a dynamic `import()` keyed on the flag so the off/default
  build never evaluates the runtime. Font/speed reuse `fontScale.ts` /
  `PlayerSettings.speed`. No domain/schema/save change.

## Post-Completion
**Manual verification:** open settings → change speed + font (apply live, persist across
reload); toggle Neural AI on (onnxruntime lazy-loads; with no model yet it's inert) and
off (no load); default fresh boot pulls no onnxruntime.
