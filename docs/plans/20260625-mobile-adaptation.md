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
      so it composes into `CameraController.zoomByFactor`; tap reports the release point.)
- [x] write tests over recorded pointer sequences (tap vs drag vs pinch disambiguation).
      (`src/tests/presentation/touchGestures.test.ts` — 17 tests: tap (drift/duration boundaries,
      no-timestamp), incremental pan deltas, pinch in/out + multiplicative compose, multi-touch
      cleanup (tap-suppressed-after-pinch, no-jump survivor pan), reset/cancel/unknown-id.)
- [x] run tests — green. (17/17 pass; eslint + `tsc --noEmit` clean; additive file, no prod
      importer yet so desktop path unchanged.)

### Task 3: On-screen flight/combat controls
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`, `FlightHud.ts`; wire the interpreter

- [x] On touch layouts, show on-screen buttons for the keyboard-only actions
      (run-turn/Space, cancel/Esc, journal/inventory), tap-to-route + pinch-zoom in
      flight, tap-to-target in combat — routed through `touchGestures` + the existing
      handlers. (`run-turn` = the existing «ХОД» `UiButton`, `journal` = `[КВЕСТЫ]`,
      `inventory` = `[I]` — already on-screen/tappable; the genuinely keyboard-only
      `cancel/Esc` is now a **touch-only «✕»** `UiButton` in `FlightHud`, gated by
      `isTouchLayoutActive()` and wired so `onCancel` runs the *exact* Esc action
      (`SpaceFlightScene.onKeyDown({key:"Escape"})`). **tap-to-route + tap-to-target
      already work on touch** via the existing single-pointer path — a touch fires a
      `button:0` `pointerdown`/`up`, so route-plan/execute and NPC-target clicks need
      no new code. **pinch-zoom is the new gesture:** the pure `TouchGestureInterpreter`
      is wired into the scene via `flight/flightTouchControls.ts` (`FlightTouchController`),
      which forwards only **touch** pointers and only on a touch layout — a 2nd finger
      flips into pinch mode (the scene drops the 1st finger's route), and pinch moves
      drive the new `CameraController.zoomByFactor(scale, anchorX, anchorY)` about the
      finger midpoint. `isTouchLayoutActive(env)` (a new shared gate in
      `responsiveLayout.ts`, also now the single source for `touchHitArea`) keeps the
      **desktop/mouse path byte-for-byte unchanged** (`pointerType !== "touch"` ⇒ every
      controller method early-returns).)
- [x] write tests: the controls dispatch the same scene actions as the keyboard.
      (`src/tests/presentation/flightTouchControls.test.ts` — pinch → `zoomByFactor`
      routing + gating (mouse / non-touch-layout ignored); `cameraController.test.ts` —
      `zoomByFactor` zoom/clamp/anchor-fixed; `flightHudTouchControls.test.ts` — the «✕»
      button is built **only** on a coarse-pointer touch layout and dispatches `onCancel`
      via the real pointer path; `responsiveLayout.test.ts` — `isTouchLayoutActive` gate
      matrix. [x] phone-viewport screenshot = manual, not automatable in the unit tier.)
- [x] run tests — green. (Full suite 3523 passed / 0 failed; `tsc --noEmit` + ESLint +
      Prettier clean; `SpaceFlightScene` size guard still < 1900 lines.)

### Task 4: Verify + relax the soft-gate
**Files:**
- Modify: the soft-gate copy/threshold; verification

- [x] Soften the gate to "best on desktop, but playable" now that touch works; full
      suite + `test:playtest` green; lint/build ok; desktop path unchanged.
      (`#mobile-gate` copy in `src/index.html` reworded from "designed for desktop —
      cramped on phone, come back from a computer" to "best on desktop, but already
      playable on touch: tap routes/targets, pinch zooms, on-screen buttons replace the
      hotkeys — you can fly right here". Pure static-HTML copy shown only when
      `shouldShowMobileGate()` is true, so **desktop never sees it** and no TS logic
      changed. Gates: full suite 3523 passed / 4 skipped, `test:playtest` 240 passed,
      `npm run lint` 0 errors, `npm run build` clean.)

### Task 5: Documentation
- [x] Document the responsive helper + touch interpreter + on-screen controls, and the
      desktop-untouched guarantee. (Added a canonical **"### Mobile Adaptation (Responsive
      Layout + Touch Controls)"** section to root `CLAUDE.md` (after Soft Mobile Gate) covering
      `responsiveLayout.ts` / `touchGestures.ts` / `flightTouchControls.ts` + the FlightHud «✕»
      button and the byte-for-byte-unchanged-desktop guarantee; plus area-focused notes in
      `src/presentation/CLAUDE.md` (responsive layout + `touchHitArea`/`UiButton`/
      `isTouchLayoutActive` single gate) and `src/presentation/flight/CLAUDE.md` (touch flight
      controls, "don't re-implement the route guards in the touch controller"). Docs-only — no
      code/test impact; doc text verified against the actual sources.)

## Post-Completion
**Manual:** play a full loop on a real phone (portrait + landscape) and a tablet — flight,
combat, trade, quests all usable; desktop unaffected.
