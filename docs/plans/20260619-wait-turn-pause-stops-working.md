---
# Fix: Wait-Turn Pause Stops Working After a While

## Overview
Bug: standing still and starting a turn ("пустить ход" with no course — a *wait* turn) advances the
calendar while the ship holds position; after some time, **pressing Pause no longer stops the turn**.
The wait turn keeps running and the player can no longer halt it. This is a regression-first bug fix:
reproduce the failure as a red test against the turn/wait/pause state machine, find the true root
cause empirically, fix it, and prove pause always stops a wait turn — even "after a while".

## Context
- **Wait-turn loop:** `src/presentation/SpaceFlightScene.ts` — a course-less turn runs in
  `advanceWaitTime(deltaTime)` (~L1313): `waitDayAccum += scaledDt / MS_PER_WAIT_DAY`
  (`MS_PER_WAIT_DAY = 1000`, ~L109), and on each whole day it calls `advanceGalaxyDay()` +
  `npcManager.refresh()`.
- **Deferred pause (the mechanism that "stops working"):** `onPlayPause()` (~L1582) — while a turn is
  running, Pause sets `pauseAtDayBoundary = true` (a *deferred* stop). The turn only actually ends
  when `advanceWaitTime`'s `while (waitDayAccum >= 1)` loop next sees the latch and calls `endTurn()`
  (~L1323–1326). `endTurn()` (~L1614) clears `isTurnRunning`, `pauseAtDayBoundary`, `waitDayAccum`.
- **Wait-loop gate (~L1297–1305):** `advanceWaitTime` only runs when `isTurnRunning && !isMoving &&
  !followNpcId && !pendingWarp && !combatModule.isActive`. If any of these flips, the latch may never
  be consumed.
- **HUD button:** `this.hud.setTurnRunning(...)` is set at init (~L558); the play/pause control maps
  to `onPlayPause`. A state desync here would make the button stop pausing.
- **Process:** per CLAUDE.md, reproduce as a red test FIRST; fix until green; visually verify the UI
  behaviour. Per memory, prove the red test actually red and confirm the production path before fixing.

## Leading hypotheses (confirm empirically; do not assume)
1. **Large/accumulated `deltaTime`** (backgrounded tab, frame hitch) makes `waitDayAccum` jump many
   days in one frame; the `while`-loop / latch interaction flushes or strands the deferred pause.
2. **`timeScale` drift** over time changing the effective wait-day rate so the latch is set between
   ever-shorter boundaries or never aligns.
3. **A fight/NPC arrival mid-wait** flips `combatModule.isActive` (or `followNpcId`), suppressing
   `advanceWaitTime` so a previously-set `pauseAtDayBoundary` latch is never consumed; when combat
   clears, the latch state is stale.
4. **HUD play/pause desync**: an automatic `endTurn()` at a day boundary leaves the button showing
   "running", so the next press starts a *new* wait turn instead of pausing (pause "stops working").
5. **Unbounded accumulator** / latch set while `!isTurnRunning`.

## Development Approach
- **Regression-first / TDD.** Drive the scene's `update`/`advanceWaitTime` over simulated frames and
  elapsed time as a pure-ish harness; assert that after Pause the wait turn ends (isTurnRunning →
  false) under the conditions that currently break it. The red test must fail for the real reason
  before any fix.
- Run `impact` on `advanceWaitTime`, `onPlayPause`, `endTurn`, and the `update` wait-gate before
  editing. **Do not modify existing test assertions** (standing rule); add new tests. Keep the
  existing moving-turn / day-advance behaviour unchanged — fix only the wait-turn pause.
- One concern per task; full suite green between tasks; visually verify in the running game.

## Testing Strategy
- Unit/harness: a wait turn started with no route, advanced over many simulated days, **always ends**
  after Pause is requested — including with a large single `deltaTime`, after N days elapsed, and
  with a combat interval interleaved then cleared; `pauseAtDayBoundary` is never left stranded while
  `isTurnRunning`; HUD turn-state matches `isTurnRunning` after an auto-`endTurn`.
- Visual/E2E: stand still, run a turn, let time pass, press Pause → the turn stops.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Reproduce the bug as a red regression test
**Files:**
- Create: src/tests/flight/waitTurnPause.test.ts

- [x] build a harness that runs the wait-turn loop over many frames/days, requests Pause, and asserts
      the turn ends; reproduce the failure (red) under the real triggering condition (large dt /
      elapsed days / combat-interleave — whichever reproduces it)
      — `src/tests/flight/waitTurnPause.test.ts`; probed all five hypotheses, the genuinely-red one is
      **large dt**: a backgrounded tab resumes with one huge `deltaTime`, and `advanceWaitTime` feeds the
      **raw unclamped** dt into `waitDayAccum` (while `ShipPhysics.update` already caps its own dt at
      100 ms, `ShipPhysics.ts:163`), so a single frame flushes ~600 game-days — the wait turn runs away
      and can no longer be halted in time.
- [x] confirm the test is red for the genuine root cause (not a mis-set fixture) — baseline test
      ("normal pacing: Pause stops the wait turn") is GREEN, proving the harness is sound; the failing
      assertion is the unclamped-dt root cause ("expected 600 to be less than or equal to 1").
- [x] run the test — must be RED before the fix — verified RED as a plain `it`; committed as `it.fails`
      so the suite/pre-commit stays green while the bug exists (Task 2 flips it to `it` once fixed).

### Task 2: Fix the root cause so Pause always stops a wait turn
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (`advanceWaitTime` / `onPlayPause` / `endTurn` /
  wait-gate — the minimal change that fixes the confirmed cause; e.g. clamp `deltaTime`, consume the
  pause latch immediately when no day-boundary will arrive, and/or keep HUD turn-state in sync)
- Modify (if HUD desync confirmed): src/presentation/flight/FlightHud.ts

- [x] apply the minimal fix for the confirmed cause; the Task 1 test goes green
      — `advanceWaitTime` now clamps the per-frame dt to one wait-day
      (`const clampedDt = Math.min(deltaTime, this.MS_PER_WAIT_DAY)`), mirroring the
      dt cap in `ShipPhysics.update`. The former-red `it.fails` repro is flipped to
      `it` and passes; a single 600 000 ms resume-frame now advances exactly one day.
- [x] add tests for the adjacent edge cases (large dt, post-combat, N-days elapsed) — all green
      — added to `src/tests/flight/waitTurnPause.test.ts`: "after a huge resume-frame,
      Pause still stops promptly", "a wait turn that has run for many days still stops on
      Pause" (200 days), and "a deferred Pause survives a combat interval and fires once
      combat clears". All 5 tests green.
- [x] ⚠️ if the fix reds an existing turn/day-advance test, STOP and re-diagnose (don't weaken it)
      — no existing test red: pauseFinishesDay (10), routeOnlyInPause (4), routeHideWhileMoving (3),
      spaceFlightE2eMethods (9), flightHud (22) all still green; no existing assertions changed.
- [x] run affected tests — must pass before next task — 53 tests across the 6 adjacent
      flight/turn/pause files pass; `npm run lint` clean (0 errors).

### Task 3: Verify acceptance criteria
- [ ] verify Overview: a wait turn can always be paused, regardless of how long it has run
- [ ] visually verify in-game: stand still, run a turn, wait, press Pause → it stops
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing flight/turn test assertions changed

## Technical Details
- The pause is a **deferred** stop tied to the wait-day boundary; the fix must guarantee the latch is
  always eventually (and promptly) consumed, or convert it to an immediate stop where no boundary will
  arrive — without reintroducing the pre-F1 immediate-stop behaviour for the normal moving turn.
- Clamp per-frame `deltaTime` so a backgrounded tab can't flush a huge number of days (and can't
  strand the latch) in a single frame.
- Keep the HUD play/pause visual state authoritative off `isTurnRunning` so an auto-`endTurn` can't
  desync the button.

## Post-Completion
**Manual verification:** stand still and start a turn; let many days pass; press Pause and confirm the
turn stops immediately/at the next day; repeat after a combat interruption and after leaving the tab
backgrounded — pause must always work.
