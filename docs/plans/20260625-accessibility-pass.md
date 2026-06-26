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

- [ ] A persisted `keymap` (action→key) with rebind + conflict detection; `flightKeyHandler`
      resolves actions through it (defaults unchanged).
- [ ] write tests: rebind persists, conflicts rejected, defaults intact.
- [ ] run tests — green.

### Task 4: Settings UI group + verify
**Files:**
- Modify: the settings panel; verification

- [ ] Add an Accessibility group (palette / reduced-motion / remap) to settings; full
      suite + `test:playtest` green; lint/build ok.

### Task 5: Documentation
- [ ] Document the palette, reduced-motion, and keymap seams + how new UI consumes them.

## Post-Completion
**Manual:** switch palette (factions stay distinguishable), enable reduced-motion (parallax
calms), rebind a key (persists) — defaults unaffected.
