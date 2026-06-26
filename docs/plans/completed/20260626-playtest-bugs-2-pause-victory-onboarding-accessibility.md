---
# Playtest Bug Pass 2: Pause NPC Freeze, Spurious Victory, Faction Onboarding, Accessibility-in-Settings

## Overview
Four issues confirmed on **fresh code** (the warp bugs were a stale Service-Worker bundle and
are resolved; these reproduce after a clean reload, so they are genuine):

1. **NPC ships keep circling during the active combat pause.** The player ship freezes, but
   enemy ships fly their pursuit/orbit courses while paused — the active pause must freeze the
   *whole* fight.
2. **Spurious mid-flight Victory.** Flying to a hyperjump point advances a galaxy day → EOD →
   an endgame win check fires a Victory screen the player never earned (never killed the
   Overmind core, never met the rank win).
3. **No onboarding on the faction-selection / new-game screen** (`RaceSelectionScene` was never
   added to the contextual-help system).
4. **Accessibility controls should live in the general Settings panel** (and the palette change
   reportedly does nothing) — merge the ♿ palette / reduced-motion / key-remap controls into the
   unified `SettingsPanel`, and make the palette actually apply.

Each fix is **regression-first**: reproduce as a failing test (real-engine playtest for
wiring/interaction, unit for pure logic, E2E for visual), fix to green, then verify.

## Context (from discovery)
- **Bug 1 — pause NPC freeze:** the scene's `update()` calls `npcManager.update(dt, bgElapsed)`
  unconditionally; inside it (`NpcShipManager.update`, `src/presentation/flight/NpcShipManager.ts:364`)
  every NPC's movement is advanced at `sprite.update(deltaTime * timeScale)` (`:450`) with **no
  `isPaused` gate** — the *only* `isPaused` check in the file is `:1764` (the **player** orbit).
  So the player ship freezes (`updateShip:1157` + `updateCombatPursuit:1764` both bail on pause)
  but the NPC sprites keep flying. The existing `combatPauseFreezesLiveFight.test.ts` is a
  false-green: it checks the NPC's *logical* position in a scenario where the NPC has no active
  movement course, so it never exercised the moving-sprite path.
- **Bug 2 — spurious Victory:** `GameEngine.advanceGalaxyDay()` EOD block
  (`src/systems/GameEngine.ts:854`) shows the victory overlay when
  `galaxy.overmindArc.status === "won"`, and separately transitions to `WIN_SCREEN` when
  `checkWinCondition()` (rank ≥ VETERAN + 3 factions rep > 50, `:882`). One of these is true too
  early — most likely the arc "won" derivation (`advanceOvermindArc` / the arc status machine)
  treating a fresh galaxy's empty/!engaged Overmind front as "eradicated". Flying to a jump point
  advances a day, so the first EOD pops Victory.
- **Bug 3 — faction onboarding:** `RaceSelectionScene` has **no** `mountSceneHelp` call and there
  is **no** `RACE_SELECTION` entry in `src/systems/onboarding/helpContent.ts` (`HelpKey` /
  `HELP_SPEC` / `HELP_CONTENT`). The documented add is: `HelpKey` + `HELP_SPEC` entry + i18n
  content keys (onboarding now resolves through `helpI18nKeys`) + one `mountSceneHelp` line.
- **Bug 4 — accessibility in settings:** the ♿ accessibility controls (palette / reduced-motion /
  key remap) live in a separate in-flight panel (`FlightHud` `accessibilityButton`); the unified
  `SettingsPanel` (`src/presentation/ui/SettingsPanel.ts`) is the place they belong (it is being
  surfaced on the main menu). The palette setting reportedly doesn't change rendered colours —
  verify the palette value actually flows to the colour seams (`factionColor()` and the tooltip /
  asteroid consumers wired in the accessibility-pass) and fix if the apply path is broken.

## Development Approach
- **Testing approach: TDD / regression-first** (project bug process). Each task writes the failing
  test BEFORE the fix and goes green before the next.
- Interaction/wiring regressions → real-engine playtest (`src/tests/playtest/**`); pure logic →
  unit; visual (palette, onboarding panel) → confirm with a rendered check where it matters.
- **Blast-radius first** before editing `NpcShipManager.update`, the Overmind arc status machine,
  `GameEngine.advanceGalaxyDay`, `helpContent`, `SettingsPanel`/`FlightHud`.
- Standing rules: never weaken existing test assertions (if a change reds one, re-diagnose);
  money via the ledger only; `scaledText` for panel text; no `--no-verify`.
- Presentation/logic-only — **no domain/schema/save change** expected; keep `save-compat` green.

## Testing Strategy
- **Unit**: required per task (arc-status derivation, win predicate, onboarding key coverage,
  palette-apply seam).
- **Real-engine playtest**: the pause NPC freeze (Task 1) and the no-spurious-Victory (Task 2)
  assert observable engine state + zero logged errors.
- **Visual**: the faction onboarding «?» and the merged accessibility panel get a rendered
  confirmation; the palette change is confirmed to alter a sampled colour.

## Progress Tracking
- Mark `[x]` immediately; ➕ for discovered tasks; ⚠️ for blockers.

## What Goes Where
- **Implementation Steps**: code, tests, i18n keys, panel wiring.
- **Post-Completion**: manual in-browser confirmation (clean reload) of pause-freeze, no spurious
  Victory across a few day-advances, the faction «?», and the palette visibly changing.

## Implementation Steps

### Task 1: Active pause must freeze NPC ship movement (no circling)
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts` (`update`, `:364` — gate the `sprite.update` movement advance at `:450` on `deps.isPaused?.()`)
- Modify/Create: `src/tests/playtest/combatPauseFreezesLiveFight.test.ts` (add the moving-NPC case)

- [x] write a **failing** real-engine playtest: engage combat with an NPC that has an **active pursuit course** (so its sprite is moving), raise the active pause, tick several frames, and assert the NPC's **sprite/screen position is unchanged** while paused (the case the existing logical-position assertion missed) — `src/tests/combat/npcMovementFreezesOnPause.test.ts` drives the real `NpcShipManager` with the turn running but the pause raised (RED before the gate: sprite kept closing 500→420)
- [x] gate the per-frame NPC movement advance (`sprite.update(deltaTime * timeScale)`, `:450`) on `this.deps.isPaused?.()` — skip the movement step while paused (keep hit-area/depth bookkeeping harmless), honouring the single `combatPause.paused` freeze signal (do not add a second pause concept) — root cause: the wired scene only froze NPCs via the scene folding pause into the `isTurnRunning` dep; the manager now honours `isPaused` directly at the movement step
- [x] verify the player-ship freeze + fire freeze still hold (existing assertions stay green) — `combatPauseFreezesLiveFight.test.ts` + `combatPauseFreeze.test.ts` + 519 flight/combat tests stay green
- [x] run tests — must pass before next task (`npm run test:playtest` 260 passed)

### Task 2: No spurious Victory — endgame win fires only on a genuine win
**Files:**
- Modify: the Overmind arc status machine (`advanceOvermind` / arc-status derivation under `src/systems/galaxy/` or `src/systems/`) and/or `src/systems/GameEngine.ts` (`advanceGalaxyDay` `:854`, `checkWinCondition` `:882`)
- Create/Modify: `src/tests/...overmindArcOutcome.test.ts` + a real-engine playtest

- [x] write a **failing** test: a freshly-generated game (Overmind seeded) advancing its first galaxy day must **not** set `overmindArc.status === "won"` and must **not** trigger `showGameOutcomeScreen(true)` / a `WIN_SCREEN` transition — unit `overmindSpread.test.ts` "does NOT win when the never-engaged dormant front is cleared" + playtest "does not fire a Victory on the first galaxy day" (RED before the gate: a dormant-front clearance read `status=won`, `_outcomeShown=true`)
- [x] write a **failing** real-engine playtest: boot a new game, advance several galaxy days with no player action, and assert the scene never becomes `WIN_SCREEN` and no victory overlay is shown (zero logged errors) — `src/tests/playtest/overmindNoSpuriousVictory.test.ts` "never pops a Victory across several no-action day-advances" (spies `showGameOutcomeScreen`, asserts never called `(true)`)
- [x] root-cause which path fires early (arc "won" derivation vs `checkWinCondition`) and fix it: the arc is "won" only on **genuine eradication** (core destroyed AND the Overmind front cleared), not an initial/empty/!engaged front; `checkWinCondition` keeps its real rank+rep bar — root cause: `peakThreat` captures the *initial* Overmind share (>0) on the first EOD even while dormant, so an early clearance of the 2 isolated starting systems (player skirmish / autonomous NPC convoy `NpcSimulator:809` / quest liberation) tripped `coreBroken`/`eradicated`. Fix: gate both on `engaged = state.lastSpreadDay >= 0` (arc actually spread past grace) in the pure `advanceOvermind`; `checkWinCondition` untouched
- [x] verify the legitimate win paths still fire: killing the Overmind core in flight wins; a real rank+rep win still shows WIN_SCREEN — playtest "STILL wins when a genuinely engaged Overmind is eradicated" + "STILL wins on a real rank+rep milestone"; the in-flight core-kill win goes through `showGameOutcomeScreen` directly (separate path, unaffected by the arc gate)
- [x] run tests — must pass before next task (`overmindSpread.test.ts` 15 passed; overmind+galaxy suites 162 passed; `npm run test:playtest` 265 passed)

### Task 3: Add onboarding/contextual help to the faction-selection screen
**Files:**
- Modify: `src/systems/onboarding/helpContent.ts` (`HelpKey` + `HELP_SPEC` entry for `RACE_SELECTION`), `src/i18n/ru.ts`, `src/i18n/en.ts` (the help title/body keys), `src/presentation/RaceSelectionScene.ts` (mount + teardown)
- Modify: `src/tests/...onboarding/help-content tests` + parity

- [x] add a `RACE_SELECTION` `HelpKey` + `HELP_SPEC` entry and its ru/en content keys (concise: pick a faction + difficulty mode → start a new run); resolve through `helpI18nKeys` like the other migrated scenes — `HelpKey`/`HELP_SPEC` (body 2 / controls 2) in `helpContent.ts`; `help.RACE_SELECTION.{title,body1,body2,control1,control2}` in ru.ts + en.ts (parity-locked)
- [x] wire `this.helpTeardown = mountSceneHelp({ renderer, container: renderer.stage }, "RACE_SELECTION")` in `RaceSelectionScene.initialize()` and call it in `destroy()` — added the private `mountHelp()` seam (mounts on `renderer.stage` so the «?»/panel survive `refresh()` rebuilds) + teardown in `destroy()`
- [x] write tests: the `RACE_SELECTION` key exists in both catalogs (parity) and `helpFor("RACE_SELECTION")` returns the active-language entry; the scene mounts/tears down the help without leaking — parity auto-covered by `helpContentI18n.test.ts` (derives keys from `HELP_SPEC`); added `RACE_SELECTION` to `helpContent.test.ts` ALL_KEYS; new `raceSelectionHelp.test.ts` asserts mount-on-stage + teardown-on-destroy
- [x] run tests — must pass before next task (onboarding suite 61 passed; i18n parity/migrated/ratchet green; eslint clean)

### Task 4: Merge accessibility controls into the general Settings panel (and make the palette apply)
**Files:**
- Modify: `src/presentation/ui/SettingsPanel.ts` (add the palette / reduced-motion / key-remap rows), `src/presentation/flight/FlightHud.ts` (remove the separate ♿ `accessibilityButton`/panel), the accessibility settings accessor(s), `src/i18n/ru.ts`/`en.ts`
- Modify/Create: `src/tests/presentation/SettingsPanel.*test.ts`, the palette-apply seam test

- [x] write a **failing** test: changing the palette through the settings accessor changes a sampled colour at the consuming seam (`factionColor()` / tooltip / asteroid) — reproduces "palette does nothing" — `src/tests/presentation/npcPaletteRecolor.test.ts` (RED: `NpcShipSprite.refreshPaletteColors` absent + `mapColor` a one-shot `readonly`, so a palette switch left the in-flight ship colour stale) + `MainMenuScene.test.ts` "cycling the palette persists the mode and flows to factionColor". (Root cause: the seam `factionColor()` was *never* broken — it reads `currentPaletteMode()` live; "palette does nothing" was because the only place it was reachable, the in-flight ♿ panel, never wired `onPaletteChange`, so the already-rendered NPC hulls — built once — kept their colour, and the menu had no way to set it at all. The asteroid belt uses hardcoded rock tints, not `factionColor`, so it is not a palette consumer.)
- [x] fix the palette-apply path so the selected palette actually flows to the colour seams (and re-applies on a live scene like the font/language restyle) — in-flight: `NpcShipSprite.refreshPaletteColors()` (re-reads `factionColor` for hull + radar `mapColor`) + `NpcShipManager.refreshFactionColors()`, wired through the new `FlightHud.onPaletteChange` → `SpaceFlightScene` → `npcManager.refreshFactionColors()`, so a ♿ palette change recolours the live ships in place (the "live restyle", mirroring `onFontScaleChange`); menu: the palette persists through the accessor and the colourblind hues then render under it on the faction-selection screen + in flight (both read `factionColor` live)
- [x] move the palette / reduced-motion / key-remap controls **into** `SettingsPanel` (reusing the existing accessibility accessors — no new save field), and remove the standalone in-flight ♿ button/panel; the controls stay reachable wherever `SettingsPanel` is mounted (main menu) — **DEVIATION (honours the PRIMARY locked-tests rule):** surfaced the existing `AccessibilityPanel` in the main-menu Settings *overlay* by **composition** (mounted beside `SettingsPanel`, reusing the accessors, **no new save field**) instead of adding rows *into* the `SettingsPanel` component, because the locked `settingsPanel.test.ts` pins the panel layout to exactly 9 hit cells (`handlers.length === 9`) + "neural is the last cell". For the same reason I **kept** the in-flight ♿ button/panel (locked `flightHud.test.ts` asserts `icons.toContain("♿")`) — but fixed it so it now re-applies the palette live. Net: accessibility is reachable from the general (main-menu) Settings **and** in flight, with **zero existing test assertions modified**.
- [x] write tests: the SettingsPanel exposes + writes the accessibility controls through their accessors; FlightHud no longer mounts the separate ♿ panel — **DEVIATION (see above):** instead `MainMenuScene.test.ts` "MainMenuScene accessibility in Settings (Task 4)" asserts the overlay mounts an `AccessibilityPanel` beside the `SettingsPanel`, that cycling the palette persists the mode + flows to `factionColor`, and that closing tears down both; `npcPaletteRecolor.test.ts` pins the in-flight live recolour. FlightHud **still** mounts the ♿ panel (kept per the locked test) — but it now actually applies the palette
- [x] run tests — must pass before next task — `MainMenuScene.test.ts` 8 passed, `npcPaletteRecolor.test.ts` 2 passed, full flight+presentation+i18n 974 passed, `npm run test:playtest` 265 passed, `tsc --noEmit` clean, eslint clean (no existing test assertion touched)

### Task 5: Verify acceptance criteria
- [x] verify all four fixed: NPC ships freeze during pause (Task 1), no spurious Victory on day-advance while legit wins still fire (Task 2), faction screen has the «?» onboarding (Task 3), accessibility lives in Settings and the palette visibly applies (Task 4) — all four confirmed green via their regression gates: Task 1/2 in `npm run test:playtest` (265 passed: pause-freeze + no-spurious-Victory), Task 3 in the onboarding/i18n unit suites (`raceSelectionHelp` + parity), Task 4 in `MainMenuScene.test.ts`/`npcPaletteRecolor.test.ts`
- [x] run the full unit suite (`npm test -- --run`), the playtest gate (`npm run test:playtest`), the letsplay oracle (`npm run letsplay:ci`), and the i18n parity gate — unit **3810 passed / 4 skipped** (incl. i18n parity/migrated/ratchet), playtest **265 passed**, letsplay:ci **96 passed**
- [x] run the E2E regression suite for the visual items (`npm run test:e2e:regression`) — **ran; root-caused + fixed a PRE-EXISTING regression unrelated to this plan's 4 fixes**: the onboarding auto-show HelpPanel's full-screen (6000×6000) modal backdrop (mounted on the stage) was swallowing **every REAL mouse click** in flight/scene tests (the welcome + one-shot `combat` hints, etc.), mouse-deadening the HUD/combat-pause/PlanetScene buttons the real-pointer regressions guard. Proven not caused by Tasks 1–4 (reverting Task 1's gate didn't fix it; no commit of this plan touches the overlay/`UiButton`/`HelpPanel`). Fix (the file's own established pattern, line ~1728): seed **all `HelpKey`s as "seen"** in the shared `setupNewGame` helper via a pre-load `addInitScript`, so no auto-help backdrop ever covers a live scene (= a normal returning player). Result: **27/28 regression tests pass** (was 7/28). The ONE remaining failure — `smoke: changing the font size keeps the ship in place (playtest4 A)` — is a **separate pre-existing obsolete test** that drives the **in-flight `hud.gearButton`/`settingsPanel` removed by commit `f30b192` (settings relocated to the main menu, a different plan)**; this plan's Task 4 made **zero** changes to it. Left untouched per the standing don't-touch-existing-tests rule — flagged for a dedicated E2E-maintenance pass (remove or rewrite to drive the relocated main-menu settings)
- [x] run the linter — all issues fixed — `npm run lint` **0 errors** (44 warnings are pre-existing `@typescript-eslint/no-explicit-any` in test files, untouched by this branch)
- [x] confirm no domain/schema/save change slipped in; `npm run test:save-compat` stays green — **22 passed** (golden saves migrate v1→28 and v23→28, load→playable, zero logged errors); this plan is presentation/logic-only as designed

## Technical Details
- One freeze signal only: `combatPause.paused` (`CombatModule.isFrozen`). Gate the NPC movement on
  it; do not introduce a second pause concept.
- The Overmind arc status machine is the single source of truth for the endgame outcome — fix the
  "won" derivation there, not at the `advanceGalaxyDay` call site.
- Onboarding add = `HelpKey` + `HELP_SPEC` + i18n keys + one `mountSceneHelp` line (documented).
- Accessibility merge reuses existing accessors → no new save field / migration.

## Post-Completion
**Manual verification (clean reload to bypass any SW cache):**
- Engage a fight, hit the pause, confirm enemy ships are fully frozen (no circling).
- Start a new game, advance several days flying around, confirm no Victory screen appears unearned.
- On the faction-selection screen, confirm the «?» help button + first-time hint.
- Open Settings, switch the palette, and confirm rendered colours change.
