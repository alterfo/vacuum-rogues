---
# Onboarding + Contextual Help on Every Screen

## Overview
New players land in the flight scene after character creation with no guidance —
nothing tells them what the game is or what to do. Add a lightweight onboarding
layer: a **welcome panel** on the first flight, a **dismissible instruction panel
that auto-shows the first time** the player opens each screen (persisted as
"seen"), and a small **«?» button** on every screen to reopen those instructions
anytime. Non-intrusive, covers every screen, and built on the existing
`showMessage`/`scaledText`/localStorage infrastructure so the per-scene wiring is
one line.

Goal: a player who has never seen the game understands, on each screen, what it is
and what to do next — and can re-read the instructions whenever they want.

## Context (from discovery)
- **No existing onboarding/tutorial/help** anywhere (greenfield).
- **Entry flow:** `RaceSelectionScene.startGame()` → `transitionTo(SPACE_FLIGHT)`
  (`RaceSelectionScene.ts:633`) — the first screen a new player sees is the flight
  scene.
- **Reusable text helper:** `src/presentation/ui/scaledText.ts` (`scaledText`) —
  dark-panel text per the presentation CLAUDE.md rule.
- **Per-scene toast pattern:** `showMessage(...)` exists in every gameplay scene
  (Flight/Planet/Trade/Station/StarMap/Bank/Government/InfoCenter/TextQuest…).
- **Persistence:** `localStorage` is already used (`sr_settings`, `sr_currentScene`)
  — the onboarding "seen" set is browser-level (not game state), so it survives
  «Новая игра» and does not need a schema change.
- **Scenes to cover (reachable gameplay):** `SPACE_FLIGHT`, `STAR_MAP`, `PLANET`,
  `TRADE`, `STATION`, `EQUIPMENT_SHOP`, `GOVERNMENT`, `INFO_CENTER`, `BANK`,
  `INVENTORY`, `TEXT_QUEST`, plus the in-flight **quest journal** (a panel) and
  **in-flight combat** (a contextual hint — the hex `CombatScene` was removed, so
  combat is real-time in the flight scene). `MAIN_MENU` already shows the premise;
  `RACE_SELECTION`/`DIALOGUE`/`WIN_SCREEN` are transient and out of scope.

Related patterns:
- The global «Оставить issue» button is a DOM overlay at bottom-right — place the
  «?» help button elsewhere (top-right) so they don't collide.
- Decision (user): first-time auto-hints + always-available «?»; cover all screens; TDD.

## Development Approach
- **Testing approach: TDD.** The content registry and the "seen" persistence are
  pure/unit-testable (write red tests first); the panel/button rendering is
  **screenshot-verified** (UI). Each task adds its tests before the next.
- **Low blast radius:** one reusable `HelpPanel` + a one-call `mountSceneHelp`
  helper; scenes opt in with a single line in `initialize()` — no scene rewrites.
  Content is pure data; persistence is injectable for tests.
- **Do NOT weaken existing tests.** Run `gitnexus impact` before touching shared
  symbols; keep changes additive. `SpaceFlightScene.ts` stays < 1900 lines (put
  logic in the helper, not the scene).

## Implementation Steps

### Task 1: Help-content registry (pure data, all screens)
**Files:**
- Create: `src/systems/onboarding/helpContent.ts`
- Create: `src/tests/onboarding/helpContent.test.ts`

- [x] Define a `HelpKey` (scene keys + `welcome`, `quest-journal`, `combat`) and a
      `HelpEntry` (`title`, `body: string[]`, optional `controls: string[]`), with
      a `HELP_CONTENT: Record<HelpKey, HelpEntry>` of concise Russian instructions
      for every reachable gameplay screen + the welcome/goal intro.
- [x] Add a `helpFor(key)` accessor.
- [x] write tests: every `HelpKey` has a non-empty title + ≥1 body line (no gaps);
      `helpFor` returns the right entry; the welcome entry states the game's goal.
- [x] run tests — green.

### Task 2: "Seen" persistence (browser-level, injectable)
**Files:**
- Create: `src/systems/onboarding/onboardingState.ts`
- Create: `src/tests/onboarding/onboardingState.test.ts`

- [x] Implement `hasSeen(key)`, `markSeen(key)`, `resetSeen()` over a `Storage`
      (default `localStorage`, key `sr_help_seen` — a JSON string set), injectable
      so tests pass a fake storage. Guard against malformed/absent JSON.
- [x] write tests: unseen→false, mark→seen, persists across reads, reset clears,
      corrupt JSON degrades to empty. (Red first.)
- [x] run tests — green.

### Task 3: Reusable HelpPanel + «?» button + `mountSceneHelp` helper
**Files:**
- Create: `src/presentation/ui/HelpPanel.ts`, `src/presentation/ui/mountSceneHelp.ts`
- Create/Modify tests under `src/tests/`

- [x] Build a themed, dismissible `HelpPanel` (dark panel via `scaledText`, title +
      body + optional controls, «Понятно»/«✕» close) and a small top-right «?»
      button.
- [x] Implement `mountSceneHelp(deps, key)`: on mount, if `!hasSeen(key)` show the
      panel once and `markSeen(key)`; always mount the «?» button that reopens the
      panel from `helpFor(key)`. Returns a teardown for `destroy()`.
- [x] Factor the auto-show decision into a pure function
      (`shouldAutoShow(key, seen)`) and unit-test it; **screenshot-verify** the
      rendered panel + «?» button. (Pure `shouldAutoShow(key, hasSeenFn)` +
      unit tests done; screenshot-verify deferred to Task 4 — no scene mounts the
      panel until then, and in-app screenshots fail here per the render-loop note.)
- [x] write tests for the pure decision + the mount/teardown wiring (fake renderer).
- [x] run tests — green.

### Task 4: Wire the core-loop screens + first-flight welcome
**Files:**
- Modify: `SpaceFlightScene.ts`, `PlanetScene.ts`, `TradeScene.ts`,
  `StationScene.ts`; the quest journal (`QuestJournalUI.ts`); in-flight combat hint
- Create/Modify tests under `src/tests/`

- [ ] Call `mountSceneHelp` in each scene's `initialize()` (flight → `welcome` on
      the very first entry, then the flight controls help; planet/trade/station →
      their keys); add «?» to the quest journal.
- [ ] Show a one-shot **combat** hint on the first in-flight engagement (first
      `addCombatant`) explaining real-time fire + the active-pause.
- [ ] write tests: each wired scene requests its help key once on first entry and
      mounts the «?» (assert against a fake `mountSceneHelp`/spy); first-flight
      shows `welcome`.
- [ ] run tests — green; **screenshot-verify** flight welcome + one screen's «?».

### Task 5: Wire the remaining screens
**Files:**
- Modify: `StarMapScene.ts`, `BankScene.ts`, `GovernmentScene.ts`,
  `EquipmentShopScene.ts`, `InfoCenterScene.ts`, `InventoryScene.ts`,
  `TextQuestScene.ts`
- Create/Modify tests under `src/tests/`

- [ ] Wire `mountSceneHelp` into each remaining scene's `initialize()` with its key.
- [ ] write tests: each scene requests its key once + mounts «?».
- [ ] run tests — green.

### Task 6: Replay onboarding (settings reset)
**Files:**
- Modify: the settings panel / main menu (a «Показать обучение заново» action)
- Create/Modify tests under `src/tests/`

- [ ] Add a «Показать обучение заново» control that calls `resetSeen()` so all
      first-time hints show again on next visit.
- [ ] write a test that the control invokes `resetSeen()`.
- [ ] run tests — green.

### Task 7: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] Every reachable gameplay screen has help content (registry test) and is wired.
- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only onboarding +
      scene-wiring symbols affected.
- [ ] full unit suite `npm test -- --run` green; `npm run lint` clean; `npm run
      build` succeeds; `SpaceFlightScene.ts` < 1900 lines.

### Task 8: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md`

- [ ] Document the onboarding pattern: `helpContent` registry + `onboardingState`
      persistence + `mountSceneHelp` one-line wiring, so new scenes add a help key.

## Technical Details
- "Seen" is browser-level localStorage (`sr_help_seen`) — independent of game
  state, so it survives «Новая игра»; the replay control resets it. No schema/
  migration change.
- The «?» button sits top-right to avoid the bottom-right «Оставить issue» overlay.

## Post-Completion
**Manual verification:**
- First-ever launch: race selection → flight shows the welcome/goal panel; opening
  each screen for the first time shows its instructions once; «?» reopens them.
- Second visit to a screen: no auto-popup, but «?» still works.
- «Показать обучение заново» → hints show again.
