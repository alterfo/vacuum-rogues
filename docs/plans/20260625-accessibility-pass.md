---
# Accessibility Pass (Colorblind, Reduced Motion, Key Remap)

## Overview
Broaden reach with a focused accessibility pass: a **colorblind-safe palette** option,
honouring **`prefers-reduced-motion`** (the soft-gate plan flagged this undone), and
**key remapping**. Low effort, partly leverages existing systems (font-scale already
ships), and removes barriers for a chunk of players.

## Context (from discovery)
- **No a11y hooks today** (no colorblind/reduce-motion/remap).
- **Font scaling exists** (`fontScale` S/M/L) — the precedent for an accessibility
  settings group.
- **Faction/UI colors** are centralised (`FACTION_COLOR` maps, palette constants) — the
  swap points for a colorblind palette.
- **Motion sources:** parallax/particle/animation in the flight scene + transitions —
  the things `prefers-reduced-motion` should damp.
- **Input:** `flightKeyHandler` is the central keydown router — the remap point.

## Development Approach
- **Testing approach: TDD.** A pure **palette selector** (mode → color map), a pure
  **reduced-motion flag** (setting OR `matchMedia('(prefers-reduced-motion)')`), and a
  pure **keymap** (action → key, with rebind + conflict detection) are unit-tested; the
  visual application is screenshot-verified.
- Settings-group additions (localStorage, like `fontScale`) → no schema/save change.

## Implementation Steps

### Task 1: Colorblind-safe palette option
**Files:**
- Create: `src/presentation/ui/palette.ts` (+ test); modify color consumers (`FACTION_COLOR` etc.)

- [x] A palette mode (`default` | `deuteranopia` | `protanopia` | `tritanopia`) mapping
      semantic colors to distinguishable hues; UI reads colors through it.
- [x] write tests: each mode yields distinguishable, total mappings; default unchanged.
- [x] run tests — green; screenshot a mode (manual visual step — skipped in headless; the
      colourblind modes are validated by the distinct/total/default-unchanged unit assertions).

### Task 2: Reduced-motion
**Files:**
- Create: `src/presentation/ui/reducedMotion.ts` (+ test); modify parallax/particle/transition callers

- [x] `reducedMotion()` = setting OR `matchMedia('(prefers-reduced-motion: reduce)')`;
      callers damp/disable parallax, heavy particles, and screen transitions when true.
      (`src/presentation/ui/reducedMotion.ts`; `SpaceBackgroundLayer.update` freezes idle
      drift/comets/swarm-nebula-twinkle pulses while keeping camera-driven parallax;
      `MainMenuScene.update` renders the backdrop but freezes star/ship/planet motion.
      There are no animated screen-transition fades in the codebase to damp.)
- [x] write tests: the flag resolves from setting + media; callers honour it.
      (`reducedMotion.test.ts` — setting/media/OR + degrade paths; `spaceBackgroundLayer.test.ts`
      — drift freezes under the flag, camera parallax still positions the nebula.)
- [x] run tests — green.

### Task 3: Key remapping
**Files:**
- Create: `src/presentation/input/keymap.ts` (+ test); modify `flightKeyHandler`

- [x] A persisted `keymap` (action→key) with rebind + conflict detection; `flightKeyHandler`
      resolves actions through it (defaults unchanged).
      (`src/presentation/input/keymap.ts`: `FlightAction` cancel/runTurn/journal/inventory →
      key, `DEFAULT_KEYMAP` verbatim with the historical Escape/Space/j/i bindings; `rebind`
      is pure with conflict detection — rejects binding a key another action holds (and an empty
      key); persisted via `localStorage("keymap")` JSON, the same client-pref class as
      `fontScale`/`paletteMode`/`reducedMotion` — no schema/save change. `flightKeyHandler`
      resolves the event to an action via `resolveFlightAction(event, ctx.keymap ?? currentKeymap())`
      and switches on it; the `keymap` ctx field is optional so existing callers/tests read the
      live persisted map. Defaults resolve byte-for-byte like the old hard-coded routing.)
- [x] write tests: rebind persists, conflicts rejected, defaults intact.
      (`src/tests/presentation/keymap.test.ts` — 20 tests: defaults map Escape/Space(code)/j/J/i/I,
      rebind onto a free key + input untouched, conflict rejection (case-insensitive), empty-key
      rejection, injectable-store persistence round-trip + partial/corrupt-map degrade, helpers.)
- [x] run tests — green. (keymap + flightKeyHandler + spaceRunsTurn = 47 passing; lint + tsc clean.)

### Task 4: Settings UI group + verify
**Files:**
- Modify: the settings panel; verification

- [x] Add an Accessibility group (palette / reduced-motion / remap) to settings; full
      suite + `test:playtest` green; lint/build ok.
      (New `src/presentation/ui/AccessibilityPanel.ts` — a **separate** panel from
      `SettingsPanel` because the latter's hit-area layout is pinned by locked tests, so
      the a11y group lives in its own ♿ HUD surface mounted beside the ⚙ gear button
      (`FlightHud`): **ПАЛИТРА** cycle button (`currentPaletteMode`/`setPaletteMode`),
      **МЕНЬШЕ ДВИЖЕНИЯ** ВКЛ/ВЫКЛ toggle (`isReducedMotionSet`/`setReducedMotion`), and
      **УПРАВЛЕНИЕ** per-action key-remap rows (`beginRebind`→capture→`rebind`+`setKeymap`,
      conflicts surfaced, Escape aborts) + «Сбросить клавиши». Each writes through its
      own browser-level `localStorage` pref — no new save field. The panel shares the
      ⚙ panel's Esc-close/outside-click/Space-suppression wiring via
      `FlightHud.isSettingsPanelOpen`/`closeModals` (so `flightKeyHandler` is untouched).
      i18n keys `a11y.*`/`palette.*`/`action.*` added to ru/en in lockstep. Tests:
      `src/tests/presentation/accessibilityPanel.test.ts` (10 cases — defaults, palette
      cycle+persist, reduced-motion toggle, rebind onto free key, conflict rejection,
      Escape-abort, reset, hit-area driven cycle/toggle/close, persisted reflection,
      destroy disposes capture). Full suite 3743 + playtest 257 green; lint 0 errors;
      tsc + prod build clean.)

### Task 5: Documentation
- [ ] Document the palette, reduced-motion, and keymap seams + how new UI consumes them.

## Post-Completion
**Manual:** switch palette (factions stay distinguishable), enable reduced-motion (parallax
calms), rebind a key (persists) — defaults unaffected.
