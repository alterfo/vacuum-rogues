# Mobile Gate & Touch Adaptation

Plan: `docs/plans/20260625-mobile-adaptation.md`. Desktop is byte-for-byte unchanged — every touch behaviour is gated, additive, and pure-logic-tested.

## Soft mobile gate

A soft, dismissible overlay for phone-class visitors. Detection (`src/systems/device/isMobileDevice.ts`): `isMobileDevice(env?)` = coarse pointer AND (small viewport < 768px OR phone user-agent). Persistence: `localStorage` flag `sr_mobile_ack` (`wasDismissed`/`markDismissed`). Overlay: hidden `#mobile-gate` in `src/index.html`; `maybeShowMobileGate()` in `main.ts` reveals it when `shouldShowMobileGate()` is true.

## Responsive layout helper

`src/presentation/ui/responsiveLayout.ts`. `layoutFor({width,height})` → `{mode: 'desktop'|'tablet'|'phone', uiScale, minTarget, touch}` — bucketed on the *shorter* side at 768/1024 breakpoints. **No panel consumes `layoutFor`/`uiScale` yet** — only `touchHitArea`/`isTouchLayoutActive` are wired.

`isTouchLayoutActive(env?)` = `layoutFor(liveViewport).touch && hasCoarsePointer(env)` — the single source of truth. A narrow desktop window never gets touch chrome.

`touchHitArea(w, h, env?)` — grows + re-centres a hit rect to `minTarget` (44 px) on a touch layout; returns exact `{0,0,w,h}` otherwise. Already wired into shared `UiButton`.

## Touch gesture interpreter

`src/presentation/flight/touchGestures.ts`. `TouchGestureInterpreter.handle({id,x,y,t?,phase})` folds a pointer stream into `PanIntent` / `PinchIntent` (scale = incremental ratio, composes multiplicatively) / `TapIntent`. Shares `DRAG_THRESHOLD` with mouse-only `PanZoomController`. Multi-touch suppresses tap; finger-lift re-baselines the survivor.

## On-screen flight controls

`FlightTouchController` (`src/presentation/flight/flightTouchControls.ts`) forwards only **touch** pointers and only on `isTouchLayoutActive()`. One-finger taps stay on the existing route/target path (a touch already fires `button:0` pointerdown/up — no new code). Second finger → pinch mode → `CameraController.zoomByFactor(scale, anchorX, anchorY)`. Keyboard-only **Esc/cancel** gets a touch-only «✕» `UiButton` in `FlightHud` (built only when `isTouchLayoutActive()`). `pointerType !== "touch"` ⇒ no-op everywhere.
