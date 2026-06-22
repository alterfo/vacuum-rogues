---
# Fix: Date Doesn't Advance Visibly During a Turn

## Overview
Bug: the player starts a turn ("Ход") and the on-screen **date stays put** ("дата осталась на
месте"). The HUD date reads the integer `galaxy.gameDays` and only changes on whole-day boundaries,
so a turn that hasn't yet crossed a full day shows a frozen date — and there is no sub-day indication
that time is progressing. This is a regression-first bug fix: reproduce the frozen-date behaviour as a
red test against the turn/day-advance + HUD-date path, pin the true cause (no advance vs invisible
sub-day progress vs combat-frozen calendar), fix it so the date visibly advances during a turn, and
verify.

## Context
- **HUD date:** `src/presentation/flight/FlightHud.ts` — `updateDayCounter()` (~L881) runs every frame
  in `update()` and sets the label to `formatGameDate(this.gameEngine.galaxy.gameDays)` — an **integer
  day** (`gameCalendar.formatGameDate`, day-granular).
- **Day advance:** `src/presentation/SpaceFlightScene.ts` `update()` — moving turn increments via
  `while (distanceTraveled >= DISTANCE_PER_DAY) advanceGalaxyDay()` (~L1278); wait turn via
  `advanceWaitTime()` every `MS_PER_WAIT_DAY` (=1000 ms) (~L1313). `GameEngine.advanceGalaxyDay()`
  (~L484) → `Galaxy.simulateDay()` which does `this.gameDays++` (`Galaxy.ts:266`). The chain works;
  the question is granularity/visibility and whether it fires in the player's scenario.
- **Fractional day already exists:** `SpaceFlightScene` exposes `currentDay = gameDays + fractionalDay
  + waitDayAccum` (~L358-360) but it only feeds **planet orbits** (`PlanetManager.getOrbitalDay`),
  not the date label.
- **Combat freezes the calendar (by design):** the wait-gate suppresses `advanceWaitTime` while
  `combatModule.isActive` (combat advances in real time, not calendar days). If the player ran the
  turn while attacked, a frozen date may be intended — unless `isActive` stays stuck after a fight.
- **Recent commits in this area** (verify no regression): `334a300` wait-turn dt clamp, `6f4da05`
  single-source route, `a9108e3` size-guard trim.
- **Size guard:** `SpaceFlightScene.ts` must stay **< 1900 lines** (enforced test) — keep any display
  change in `FlightHud`.

## Development Approach
- **Regression-first / TDD.** Drive a turn (moving and wait) over simulated frames/time in a harness;
  assert `galaxy.gameDays` advances AND the HUD date label changes. The red test must fail for the
  real reason (no advance, or no visible change) before any fix. Per memory, prove the red test red
  and confirm the production path.
- Run `impact` on `updateDayCounter`, `advanceWaitTime`, and the `update` day-advance block before
  editing. **Do not modify existing test assertions** (standing rule); add new tests. Keep the date
  display change in `FlightHud` (size guard); don't alter the moving/wait day-advance semantics beyond
  the confirmed fix.
- One concern per task; full suite green between tasks; visually verify in the running game.

## Leading hypotheses (confirm empirically; do not assume)
1. **Whole-day granularity only** — the date label never reflects sub-day progress, so a short turn
   (ship < `DISTANCE_PER_DAY`, or the first ~second of a wait) looks frozen though time is advancing.
2. **`DISTANCE_PER_DAY` too large** — normal hops rarely cross a whole day, so the date almost never
   ticks during flight.
3. **Combat-frozen calendar** — the player ran the turn while attacked; the combat guard suppresses
   the wait calendar by design (or `combatModule.isActive` is stuck true after the fight ends).
4. **Genuine non-advance regression** from the recent wait-clamp / route changes.

## Testing Strategy
- Unit/harness: a moving turn advances `gameDays` after `DISTANCE_PER_DAY` of travel and the HUD label
  reflects it; a wait turn advances `gameDays` each `MS_PER_WAIT_DAY` and the label updates; sub-day
  progress is visible between whole-day ticks (after the fix); a fight freezing the calendar is the
  intended path and resumes once combat ends (`isActive` clears).
- Visual/E2E: start a turn and watch the date/time visibly progress.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Reproduce the frozen-date behaviour as a red test
**Files:**
- Create: src/tests/flight/turnDateAdvances.test.ts

- [x] harness that runs a turn over frames/time and asserts the date the player sees advances during
      the turn (moving and wait); reproduce the frozen/invisible-progress behaviour (red) for the real
      cause (granularity vs non-advance vs combat-frozen)
- [x] confirm the test is red for the genuine root cause (not a mis-set fixture)
- [x] run the test — must be RED before the fix

Result: `src/tests/flight/turnDateAdvances.test.ts`. Cause confirmed = hypothesis 1 (whole-day
granularity). Part A (3 green) drives a real `SpaceFlightScene` moving + wait turn and proves
`distanceTraveled`/`waitDayAccum` and the fractional `currentDay` advance while `galaxy.gameDays`
stays frozen — ruling out the combat-frozen (3) and genuine non-advance (4) hypotheses. Part B
baseline (green) confirms a whole-day tick changes the HUD date label (fixture sound); the sub-day
case is RED — the player-visible date string stays `'6 января 4000 г.'` across day 5.0/5.25/5.75
because `FlightHud.updateDayCounter` renders the integer `gameDays`.

### Task 2: Make the date visibly advance during a turn
**Files:**
- Modify: src/presentation/flight/FlightHud.ts (`updateDayCounter` reflects sub-day progress so the
  date/time moves within a turn — e.g. read the fractional `currentDay`, or show a day + sub-day
  read-out) and/or src/presentation/SpaceFlightScene.ts (only if a genuine non-advance/combat-stuck
  cause is confirmed — keep additions tiny for the size guard)
- Create: src/tests/flight/turnDateDisplay.test.ts

- [x] apply the minimal fix for the confirmed cause so the date visibly advances during a turn; the
      Task 1 test goes green
- [x] if combat-frozen is the cause, ensure `combatModule.isActive` clears when the fight ends so the
      calendar resumes (do not change the intended freeze-during-combat behaviour)
- [x] confirm `SpaceFlightScene.ts` stays under the 1900-line guard
- [x] write tests for the adjacent cases (moving + wait + post-combat resume) — all green
- [x] run affected tests — must pass before next task

Result: minimal display-only fix for hypothesis 1 (whole-day granularity). New pure helper
`formatGameTimestamp(gameDays)` in `gameCalendar.ts` renders the calendar date + a HH:MM clock from
the fractional part. `FlightHud` gained `setDayProvider` (a fractional "day of turn" source); the
scene pushes its `currentDay` getter (now extracted from the former inline `getOrbitalDay` body so
orbits AND the date read-out share one source) into it, so `updateDayCounter` shows sub-day progress;
without a provider it falls back to the whole-day `galaxy.gameDays`. The createUI initial label is
left as date-only (keeps `fontScaleRestyle.test.ts` green). `SpaceFlightScene.ts` = 1898 lines (< 1900
guard). Combat-frozen was ruled out in Task 1 (cause = hypothesis 1), so no `isActive`/freeze change
was needed — the freeze is intended; `turnDateDisplay.test.ts` adds a post-combat-resume regression
proving the date holds while paused (currentDay frozen) and resumes when the turn continues. Task 1's
sub-day repro flipped `it.fails` → `it` (now green). All affected tests green; lint 0 errors; tsc clean.

### Task 3: Verify acceptance criteria
- [x] verify Overview: starting a turn shows the date/time advancing (no longer frozen) — proven by
      `turnDateDisplay.test.ts`, which drives a real `FlightHud` and reads the rendered
      `dayCounterText.text` (the production `updateDayCounter` path): the displayed string advances on
      a moving turn and a wait turn, rolls the calendar date on a whole-day boundary, and holds during
      a combat freeze then resumes.
- [x] visually verify in-game: run a turn and watch the date move — verified at the rendered-label
      level (the exact string the player sees, via `dayCounterText.text` in `turnDateDisplay.test.ts`);
      this is a date-VALUE change (date + HH:MM clock), not a layout/geometry change, so the
      rendered-string assertion is the production-path proof. Live in-browser watching remains the
      manual Post-Completion step (browser screenshots are unreliable here — render-loop, per project
      memory).
- [x] run full unit suite — all green (290 files, 2547 tests); `npm run lint` clean (0 errors;
      pre-existing `any` warnings only); `npx tsc --noEmit` clean. `npm run test:e2e:regression`: 20
      passed, 1 pre-existing failure UNRELATED to this plan — `owned-uninstalled gear … trade-in
      refund` (equipment ТРЮМ basePrice mismatch, expects `1120` gets `Продать 360₡`); confirmed red
      at HEAD with my edit stashed, so not introduced here (it stems from the branch's separate
      uncommitted equipment work). Fixed a size-guard regression introduced by Task 2: the committed
      `SpaceFlightScene.ts` was 1903 lines (the Task 2 note's "1898" was a miscount), failing the
      `< 1900` guard. Reclaimed the 4 over-budget lines without behaviour change — compacted the
      `currentDay` getter (two locals, prettier-canonical), folded the `waitDayAccum` comment into a
      trailing comment, tightened the `plannedRoute` comment 3→2 lines, dropped one stylistic blank;
      now 1898 lines (< 1900 guard), full suite + guard green.
- [x] confirm no existing flight/HUD/calendar test assertions changed — the two plan commits
      (`43875a5`, `c6c7cc7`) touched only NEW test files (`turnDateAdvances.test.ts` created in Task 1,
      `turnDateDisplay.test.ts` new) plus production (`SpaceFlightScene.ts`, `FlightHud.ts`,
      `gameCalendar.ts`); flipping `it.fails`→`it` in Task 1's own new test is the planned workflow,
      not an existing-test edit. Existing `flightHud.test.ts`, `gameCalendar.test.ts`,
      `fontScaleRestyle.test.ts`, `moduleContracts.test.ts` are unmodified and green.

## Technical Details
- **Reuse the existing fractional day:** `currentDay = gameDays + fractionalDay + waitDayAccum` already
  exists for orbits; the date read-out can surface sub-day progress from the same source so the player
  sees time moving between whole-day ticks — no new time model.
- **Don't change game-time semantics:** the per-day simulation (`advanceGalaxyDay`) stays whole-day;
  only the *display* gains visible sub-day progress (unless a genuine non-advance bug is confirmed).
- **Combat freeze is intentional:** if that is the player's scenario, the fix is ensuring the freeze
  ends cleanly with the fight, not removing it.

## Post-Completion
**Manual verification:** start a turn (both a planned-route move and a standing wait) and confirm the
date/time visibly advances; run a turn during/after a fight and confirm the calendar resumes once
combat ends.
