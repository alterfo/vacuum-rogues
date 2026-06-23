---
# Real-Engine Playtest Harness (close the integration gap)

## Overview
A recurring failure mode: bugs pass all 2630 unit tests but break the real game
(combat doesn't fire, «Новая игра» didn't reset, the hex-removal save-crash), and
only the human playtester catches them. Root cause: unit tests heavily **mock**
PixiJS *and* the services, so they validate pure logic in isolation — never the
**wiring** between real components. Fix it by adding a **real-engine, headless
integration harness** that boots the *real* `GameEngine` + *real* systems and
drives behaviour scenarios through the journeys that keep breaking, asserting
observable state + **zero logged/thrown errors** throughout.

Key properties:
- **Real wiring:** real `GameEngine`, `GalaxyService`, `QuestManager`,
  `BankingService`, real scene logic — only PixiJS is stubbed (minimally).
- **Behaviour-first (the "BDD" answer):** scenarios read Given-When-Then over the
  real system, not mocked seams. No Cucumber, no migration of existing tests.
- **ralphex-runnable:** it's Vitest (fast, headless), so ralphex validates its own
  fixes against the real flow inside its loop — not just a mock.
- **Convention:** an integration/scene bug's regression goes **here** (real flow),
  never a mocked unit test that re-creates the false green.

This is additive — the 2630 existing unit tests stay untouched.

## Context (from discovery)
- **Existing E2E (Playwright, not gated):** `e2e/playtest-regression.spec.ts`,
  `playtest-01..03`, `monkey-01/02`, `letsplay-discovery` drive the real game via
  `window.__gameEngine`; helpers `e2e/helpers/gameDriver.ts`,
  `errorCollector.ts`, `monkeyTester.ts`; page objects per scene. **pre-push runs
  unit + build only — E2E never runs automatically.**
- **Unit tests mock the seams:** ~15 `src/tests/**` build `new GameEngine` but with
  `MockGalaxyService`/`MockQuestService`/`MockPlayerService` — real engine, mocked
  systems. The pixi.js `vi.mock(...)` block (see
  `GameEngine.new-game-reset.test.ts`) is the reusable minimal Pixi stub.
- **`__DEBUG__` exposes the engine:** `main.ts` sets `window.__gameEngine` in
  debug/test builds — the same hook the harness drives.
- The flows that broke this month (combat, new-game reset, local-delivery,
  save-load) are the seed scenario set.

## Development Approach
- **Behaviour-first integration scenarios.** Each scenario is Given-When-Then over
  the real engine; assertions are observable game state + an error-invariant.
- **Real systems, stub only Pixi.** Reuse the existing `vi.mock("pixi.js")` block;
  wire REAL `GalaxyService`/`QuestManager`/`BankingService` (not `Mock*`) so the
  integration is genuine.
- Additive only — do not modify existing unit tests. Run `gitnexus impact` before
  touching shared engine symbols. Each task ends with its scenarios green + lint.

## Implementation Steps

### Task 1: Real-engine playtest driver
**Files:**
- Create: `src/tests/playtest/realEngineHarness.ts`
- Create: `src/tests/playtest/realEngineHarness.test.ts`

- [x] Build a harness that constructs the **real** `GameEngine` with real services
      (`GalaxyService`, `PlayerService`, `QuestManager`, `BankingService`,
      `AdaptiveQualityProfile`) + the shared minimal `pixi.js` stub, and an
      **error sink** that records every `logger.error`/thrown error during a run.
- [x] Expose a small driver API: `newGame(faction?)`, `goTo(sceneType)`,
      `currentScene()`, `player()`, `galaxy()`, `quests()`, `credits()`, and
      `errors()` (the recorded list).
- [x] write tests proving the harness boots a real game, transitions scenes
      without throwing, and `errors()` is empty on a clean boot.
- [x] run tests — green.

### Task 2: Core-journey behaviour scenarios
**Files:**
- Create: `src/tests/playtest/journeys.test.ts`

- [x] Scenario **new game is fresh**: Given an in-progress game with quests/credits/
      flight pos, When «Новая игра», Then player/quests/ledger/flight-pos are reset.
- [x] Scenario **fly → land → trade**: Given a fresh game in flight, When the player
      routes to a planet and lands, Then the planet scene is reachable and the market
      is openable (no errors).
- [x] Scenario **local delivery to a neighbour**: Given a «Местный подряд», When the
      player buys cargo and lands on the **target** planet, Then it completes and pays
      (and landing on the issuer planet does not).
- [x] Scenario **combat engages**: Given a weaponed player and a hostile NPC in
      range, When combat ticks, Then both sides fire and hull drops (NPC death routes
      to loot, player death to game-over) — no false win from NPC-vs-NPC crossfire.
- [x] Assert the **error-invariant** (`errors()` empty) at the end of every scenario.
- [x] run scenarios — green.

### Task 3: Error-invariant + "always actionable" net
**Files:**
- Create: `src/tests/playtest/invariants.test.ts`

- [ ] A broad scenario that boots a new game and drives a short scripted sequence
      (turn, land, open each reachable scene), asserting **zero logged/thrown
      errors** and that the player is never left with no available action (no
      dead-ends) — the cheap catch-all for the "X is not a constructor / cannot read
      property" class.
- [ ] run — green.

### Task 4: Make the playtest a gate + convention
**Files:**
- Modify: `lefthook.yml` (run the `src/tests/playtest/**` suite on pre-push;
  optionally the Playwright `playtest-regression` in CI)
- Modify: `CLAUDE.md`

- [ ] Add the `src/tests/playtest` suite to the pre-push gate (it's Vitest, fast).
- [ ] Document the convention in `CLAUDE.md`: integration/scene bugs get their
      regression in the **real-engine playtest harness** (behaviour over the real
      system), not a mocked unit test; unit tests stay for pure logic.
- [ ] (Optional) wire the Playwright `playtest-regression` spec into CI for the
      visual/rendered layer the headless harness can't see.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] Re-introduce (locally, throwaway) one of this month's bugs (e.g. revert the
      new-game reset) and confirm a playtest scenario goes **red** — proving the
      harness would have caught it.
- [ ] full unit suite + the new playtest suite green; `npm run lint` clean; build ok.

### Task 6: Update documentation
**Files:**
- Modify: `docs/DEVELOPER_GUIDE.md` / testing notes

- [ ] Describe the three tiers — unit (mocked logic), **real-engine playtest
      (integration behaviour)**, Playwright E2E (rendered/visual) — and when to use
      each.

## Technical Details
- The harness stubs only PixiJS; everything else is real, so it exercises real
  scene transitions, the combat module, quest completion and the banking bus.
- The error sink wraps `logger.error` + a global `unhandledrejection`/`error`
  capture for the run's duration.

## Post-Completion
**Manual verification:**
- After this lands, the human playtest becomes a *confirmation* step, not the
  primary defect-finder: the harness should catch wiring/integration breakage in
  CI/pre-push first.
