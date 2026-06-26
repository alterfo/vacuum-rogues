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

- [ ] add a `RACE_SELECTION` `HelpKey` + `HELP_SPEC` entry and its ru/en content keys (concise: pick a faction + difficulty mode → start a new run); resolve through `helpI18nKeys` like the other migrated scenes
- [ ] wire `this.helpTeardown = mountSceneHelp({ renderer, container: renderer.stage }, "RACE_SELECTION")` in `RaceSelectionScene.initialize()` and call it in `destroy()`
- [ ] write tests: the `RACE_SELECTION` key exists in both catalogs (parity) and `helpFor("RACE_SELECTION")` returns the active-language entry; the scene mounts/tears down the help without leaking
- [ ] run tests — must pass before next task

### Task 4: Merge accessibility controls into the general Settings panel (and make the palette apply)
**Files:**
- Modify: `src/presentation/ui/SettingsPanel.ts` (add the palette / reduced-motion / key-remap rows), `src/presentation/flight/FlightHud.ts` (remove the separate ♿ `accessibilityButton`/panel), the accessibility settings accessor(s), `src/i18n/ru.ts`/`en.ts`
- Modify/Create: `src/tests/presentation/SettingsPanel.*test.ts`, the palette-apply seam test

- [ ] write a **failing** test: changing the palette through the settings accessor changes a sampled colour at the consuming seam (`factionColor()` / tooltip / asteroid) — reproduces "palette does nothing"
- [ ] fix the palette-apply path so the selected palette actually flows to the colour seams (and re-applies on a live scene like the font/language restyle)
- [ ] move the palette / reduced-motion / key-remap controls **into** `SettingsPanel` (reusing the existing accessibility accessors — no new save field), and remove the standalone in-flight ♿ button/panel; the controls stay reachable wherever `SettingsPanel` is mounted (main menu)
- [ ] write tests: the SettingsPanel exposes + writes the accessibility controls through their accessors; FlightHud no longer mounts the separate ♿ panel
- [ ] run tests — must pass before next task

### Task 5: Verify acceptance criteria
- [ ] verify all four fixed: NPC ships freeze during pause (Task 1), no spurious Victory on day-advance while legit wins still fire (Task 2), faction screen has the «?» onboarding (Task 3), accessibility lives in Settings and the palette visibly applies (Task 4)
- [ ] run the full unit suite (`npm test -- --run`), the playtest gate (`npm run test:playtest`), the letsplay oracle (`npm run letsplay:ci`), and the i18n parity gate
- [ ] run the E2E regression suite for the visual items (`npm run test:e2e:regression`)
- [ ] run the linter — all issues fixed
- [ ] confirm no domain/schema/save change slipped in; `npm run test:save-compat` stays green

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
