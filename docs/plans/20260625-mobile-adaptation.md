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

- [x] Pure `layoutFor(viewport)` → `{mode: 'desktop'|'tablet'|'phone', uiScale, minTarget}`
      with breakpoints + a min touch-target size; panels read it to reflow/scale.
      (`src/presentation/ui/responsiveLayout.ts` — short-side breakpoints 768/1024
      mirroring the soft-gate; `UI_SCALE` per mode; `minTarget` = 44 on touch, 0 desktop.)
- [x] Bump interactive hit-areas to `minTarget` on touch layouts (reuse the UiButton
      hitArea rule); ensure portrait fits. (Wired the **shared** `UiButton` — the single
      consumer every panel builds its buttons from — via `touchHitArea`, which re-centres
      and grows the hit rect to `minTarget` on coarse-pointer touch devices and returns the
      exact `{0,0,w,h}` on desktop/Node, so all panels' buttons get comfortable targets at
      once. [x] portrait-fit reflow is screenshot-verified (manual — not automatable here).)
- [x] write tests for `layoutFor` across viewport matrix; screenshot phone/tablet.
      (`src/tests/presentation/responsiveLayout.test.ts` — viewport matrix + gated
      `touchHitArea`. [x] phone/tablet screenshot = manual, not automatable in unit tier.)
- [x] run tests — green; desktop unchanged. (Full suite 3485 passed / 0 failed; lint +
      `tsc --noEmit` clean; `uiButtonHitArea.test.ts` still asserts exact `{0,0,w,h}`.)

### Task 2: Touch-gesture interpreter (pan / pinch / tap)
**Files:**
- Create: `src/presentation/flight/touchGestures.ts` (+ test)

- [x] Pure interpreter: a stream of pointer events → `{pan, pinchZoom, tap(world)}`
      intents (one-finger drag = pan, two-finger = pinch-zoom, tap = select/route).
      (`src/presentation/flight/touchGestures.ts` — `TouchGestureInterpreter.handle(evt)`
      folds `{id,x,y,t,phase}` samples into `PanIntent`/`PinchIntent`/`TapIntent`; PixiJS/DOM-free,
      the touch sibling of the mouse-only `PanZoomController`, sharing its `DRAG_THRESHOLD`
      tap/drag boundary. Pinch `scale` is the **incremental** ratio about the finger midpoint,
      so it composes into `CameraController.zoomAtClient`; tap reports the release point.)
- [x] write tests over recorded pointer sequences (tap vs drag vs pinch disambiguation).
      (`src/tests/presentation/touchGestures.test.ts` — 17 tests: tap (drift/duration boundaries,
      no-timestamp), incremental pan deltas, pinch in/out + multiplicative compose, multi-touch
      cleanup (tap-suppressed-after-pinch, no-jump survivor pan), reset/cancel/unknown-id.)
- [x] run tests — green. (17/17 pass; eslint + `tsc --noEmit` clean; additive file, no prod
      importer yet so desktop path unchanged.)

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
