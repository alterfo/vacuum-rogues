---
# Mobile "Best on Desktop" Soft Gate

## Overview
The game is keyboard-driven and laid out for large screens; on phones it's cramped
and not optimised, which draws "не оптимизировано под мобилки" complaints. Add a
**soft, dismissible boot gate**: on a mobile/touch device, show a full-screen,
friendly **in-universe notice** that the game is best on desktop, with a **«Всё
равно продолжить»** button that lets a determined visitor proceed (and remembers
the choice). This sets expectations up front — heading off the complaint — without
hard-locking out a misdetected tablet or desktop.

(Explicitly **not** doing the insulting/classist message from the request — the
copy is friendly; a demeaning notice would damage the game's reputation more than a
missing mobile layout.)

## Context (from discovery)
- **Boot-gate precedent:** `src/main.ts` `checkDomainLock()` (~L87) runs on boot
  (production only) and, when the domain isn't allowed, replaces the page and stops
  the engine. The device gate mirrors this shape but is **soft** (overlay the visitor
  can dismiss) rather than a hard stop.
- **Overlay precedent:** the boot loader + the global «?»/«Оставить issue» button
  are HTML/CSS in `src/index.html`, revealed/hidden by `main.ts` — the same pattern
  the mobile gate uses (instant paint, no PixiJS).
- **No existing mobile/touch handling** in `main.ts`/`index.html` (greenfield).
- **Persistence:** browser-level `localStorage` is already used (`sr_settings`,
  `sr_help_seen`) — the "I dismissed the mobile notice" flag is the same kind (no
  schema change).

## Development Approach
- **Testing approach: TDD.** The detection is a pure function tested against a
  device matrix (UA + `pointer: coarse` + viewport); the dismiss/persist logic is
  pure too. The overlay itself is **screenshot-verified**.
- Detection is **injectable** (pass `navigator`/`window`/`matchMedia`) so tests
  don't depend on the real environment. Keep it conservative — a false *positive*
  (warning a desktop) is mildly annoying; the soft "continue" button makes it
  harmless either way.
- Additive; touches only `main.ts` + `index.html` + a new helper. No engine change.

## Implementation Steps

### Task 1: Pure `isMobileDevice()` detection
**Files:**
- Create: `src/systems/device/isMobileDevice.ts`
- Create: `src/tests/device/isMobileDevice.test.ts`

- [ ] Implement `isMobileDevice(env?)` that returns true for a phone-class device,
      combining signals: a coarse primary pointer (`matchMedia('(pointer: coarse)')`),
      a small viewport (e.g. `min(innerWidth, innerHeight) < 768`), and a
      phone/tablet user-agent hint — injectable via an `env` param (defaults to the
      real `window`/`navigator`).
- [ ] write tests over a device matrix: phone UA + coarse + small → true; desktop
      (fine pointer, large, desktop UA) → false; large touchscreen / hybrid →
      conservative (don't over-trigger); missing APIs degrade safely.
- [ ] run tests — green.

### Task 2: Soft gate overlay + dismiss/persist wiring
**Files:**
- Modify: `src/index.html` (the `#mobile-gate` overlay + CSS)
- Modify: `src/main.ts` (reveal on boot when mobile + not yet dismissed; wire the button)
- Create: `src/systems/device/mobileGateState.ts` (+ test) for the dismissed flag
- Create/Modify tests under `src/tests/`

- [ ] Add a hidden `#mobile-gate` HTML/CSS overlay (themed like the boot loader)
      with the friendly in-universe copy — e.g. title «Тесновато для рейса, пилот»,
      body "«Вакуумные Пройдохи» рассчитаны на десктоп — клавиатура и крупный экран;
      на телефоне будет тесно. Зайдите с компьютера для полного полёта." — and a
      **«Всё равно продолжить»** button.
- [ ] `mobileGateState`: `wasDismissed()` / `markDismissed()` over `localStorage`
      (`sr_mobile_ack`), injectable for tests.
- [ ] In `main.ts`, after boot, call a `maybeShowMobileGate()` that reveals the
      overlay when `isMobileDevice() && !wasDismissed()`; «Всё равно продолжить»
      hides it and `markDismissed()` (so it won't nag on every load).
- [ ] write tests: shown when mobile + not dismissed; not shown on desktop or after
      dismissal; dismiss persists. (Pure decision + state, fake env/storage.)
- [ ] run tests — green; **screenshot-verify** the overlay (mobile viewport).

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only device gate +
      main.ts/index.html affected.
- [ ] full unit suite green; `npm run lint` clean; `npm run build` ok; the desktop
      boot path is unchanged (gate never shows on desktop).

### Task 4: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` or `docs/` notes

- [ ] Note the soft device gate: `isMobileDevice` detection + the dismissible
      `#mobile-gate` overlay + the `sr_mobile_ack` persistence; desktop unaffected.

## Technical Details
- Soft, not hard: the engine still boots underneath; the overlay just sets
  expectations until dismissed, so a misdetected desktop loses nothing.
- All browser-level (`localStorage`) — no schema/migration change.

## Post-Completion
**Manual verification:**
- Open the deployed game on a phone → the friendly notice appears; «Всё равно
  продолжить» enters the game and isn't shown again on that device.
- On desktop → no notice; normal boot.
