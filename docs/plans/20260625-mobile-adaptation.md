---
# Mobile Adaptation (Responsive Layout + Touch Controls)

## Overview
The game is keyboard-driven and laid out for large screens; today mobile users get the
dismissible **soft-gate** ("best on desktop"). Make it actually playable on touch
devices, **phased**: Phase 1 = responsive layout + comfortable tap targets (menus,
trade, quests are already tappable); Phase 2 = on-screen touch controls for flight/
combat (the keyboard-only actions). The soft-gate stays as the fallback until Phase 2
lands.

## Context (from discovery)
- **Soft-gate already exists** (`docs/plans/completed/20260623-mobile-device-soft-gate.md`,
  `isMobileDevice`, `#mobile-gate`).
- **Input plumbing is half there:** `Renderer` resizes the canvas (`resizeTo`), and
  PixiJS uses **pointer events** — taps already hit `eventMode="static"` buttons.
- **Font/scaling head start:** `scaledText`/`fontScale` (S/M/L) already scale panel text.
- **Missing:** responsive panel reflow for small/portrait viewports, bigger touch
  targets, pinch-zoom + tap-to-route in flight, and on-screen equivalents for the
  `flightKeyHandler` shortcuts (Space/Esc/j/i).

## Development Approach
- **Testing approach: TDD.** A pure responsive-layout helper (viewport → layout mode +
  scale/target-size) and a pure touch-gesture interpreter (pointer events → pan/pinch/
  tap intents) are unit-tested; the on-screen controls + reflow are screenshot-verified
  at phone/tablet viewports. Desktop path must stay byte-for-byte unchanged.
- Additive; gated by `isMobileDevice()` / viewport so desktop is untouched. No
  domain/schema/save change.

## Implementation Steps

### Task 1: Responsive layout helper + comfortable tap targets
**Files:**
- Create: `src/presentation/ui/responsiveLayout.ts` (+ test)
- Modify: panel builders (StationScene/TradeScene/JobBoard/etc.) to consume it

- [ ] Pure `layoutFor(viewport)` → `{mode: 'desktop'|'tablet'|'phone', uiScale, minTarget}`
      with breakpoints + a min touch-target size; panels read it to reflow/scale.
- [ ] Bump interactive hit-areas to `minTarget` on touch layouts (reuse the UiButton
      hitArea rule); ensure portrait fits.
- [ ] write tests for `layoutFor` across viewport matrix; screenshot phone/tablet.
- [ ] run tests — green; desktop unchanged.

### Task 2: Touch-gesture interpreter (pan / pinch / tap)
**Files:**
- Create: `src/presentation/flight/touchGestures.ts` (+ test)

- [ ] Pure interpreter: a stream of pointer events → `{pan, pinchZoom, tap(world)}`
      intents (one-finger drag = pan, two-finger = pinch-zoom, tap = select/route).
- [ ] write tests over recorded pointer sequences (tap vs drag vs pinch disambiguation).
- [ ] run tests — green.

### Task 3: On-screen flight/combat controls
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`, `FlightHud.ts`; wire the interpreter

- [ ] On touch layouts, show on-screen buttons for the keyboard-only actions
      (run-turn/Space, cancel/Esc, journal/inventory), tap-to-route + pinch-zoom in
      flight, tap-to-target in combat — routed through `touchGestures` + the existing
      handlers.
- [ ] write tests: the controls dispatch the same scene actions as the keyboard;
      screenshot-verify on a phone viewport.
- [ ] run tests — green.

### Task 4: Verify + relax the soft-gate
**Files:**
- Modify: the soft-gate copy/threshold; verification

- [ ] Soften the gate to "best on desktop, but playable" now that touch works; full
      suite + `test:playtest` green; lint/build ok; desktop path unchanged.

### Task 5: Documentation
- [ ] Document the responsive helper + touch interpreter + on-screen controls, and the
      desktop-untouched guarantee.

## Post-Completion
**Manual:** play a full loop on a real phone (portrait + landscape) and a tablet — flight,
combat, trade, quests all usable; desktop unaffected.
