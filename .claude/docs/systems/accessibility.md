# Accessibility Seams

Plan: `docs/plans/20260625-accessibility-pass.md`. Three opt-in seams — colorblind palette, reduced-motion flag, key remap — each a pure module backed by `localStorage` (same class as `fontScale`/`neuralEnabled` — no save-schema/migration change). All default to historical behaviour.

## Consuming seams (the rule)

**Read through the seam, never re-derive at a call site.** Details in `.claude/docs/adding-features.md` → "Consuming an Accessibility seam".

### Faction colour → `factionColor(faction, mode?)`

`src/presentation/ui/palette.ts`. `PaletteMode` = `default | deuteranopia | protanopia | tritanopia`. `factionColor` is the single source of truth — accepts `Faction` or `FactionType`, defaults to `currentPaletteMode()`. **Never read a raw faction-colour map at a call site.**

A long-lived display object built once keeps its old hue — recolouring on a palette switch needs an explicit re-apply seam: `NpcShipSprite.refreshPaletteColors()` → `NpcShipManager.refreshFactionColors()` → `FlightHud.onPaletteChange` → `SpaceFlightScene`. New persistent faction-coloured objects must expose their own `refresh*Colors()`.

### Idle/decorative motion → `reducedMotion(env?)`

`src/presentation/ui/reducedMotion.ts`. `reducedMotion()` = explicit player setting (`localStorage("reducedMotion")`) OR OS `prefers-reduced-motion`. Read **per-frame** in `update(dt)` (cheap + storage-guarded). Freeze idle drift, comets, swarm-nebula twinkle, menu backdrops — not camera-driven parallax. **New idle/parallax/heavy-particle animation must gate on `reducedMotion()`.**

Content-reveal animation gates on the same seam: `TextQuestScene`'s progressive (typewriter) quest narration (`docs/plans/20260726-quest-and-hub-polish-pass.md` Task 2) checks `isReducedMotionSet()` in `startReveal` — under reduced motion (or empty text) it snaps to the full string and runs its continuation synchronously instead of typing character-by-character. A transparent skip-catcher over the description panel lets any player `completeReveal()` early on `pointerdown`.

### Flight shortcut → `FlightAction` + keymap

`src/presentation/input/keymap.ts`. Named `FlightAction` (`cancel`/`runTurn`/`journal`/`inventory`) bound to a key in `FlightKeymap`. Route via `resolveFlightAction(event, ctx.keymap ?? currentKeymap())` in `flightKeyHandler`. `rebind(map, action, key)` is pure with conflict detection. Persists via `localStorage("keymap")` JSON. **Never add `event.key === "x"` branches — always go through a `FlightAction`.**

## The ♿ panel

`src/presentation/ui/AccessibilityPanel.ts` — **ПАЛИТРА** cycle / **МЕНЬШЕ ДВИЖЕНИЯ** toggle / **УПРАВЛЕНИЕ** per-action rebind rows + «Сбросить клавиши». Separate from `SettingsPanel` (whose hit-area layout is pinned by locked tests). Mounted: (1) in-flight ♿ HUD beside the ⚙ button, (2) on the main-menu Settings overlay (composed beside `SettingsPanel`). Control actions are public for unit testing. i18n keys `a11y.*`/`palette.*`/`action.*` live in ru/en lockstep.
