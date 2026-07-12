# Autopilot Reliability Fixes

## Overview

The dev-only live autopilot (`window.__autopilot`, backtick-toggle in `npm run dev`) has three distinct reliability regressions reported from live play:

1. **Frequent, spurious disengagement** — the autopilot drops control far more often than expected, even when the player didn't intend to retake it.
2. **Wrong hyperjump exit/entry geometry** — after a warp, the ship's exit point on the origin system's boundary and its entry point in the destination system don't line up with the target system's actual direction; the jump feels like it happens "from nowhere" instead of from the projected boundary point.
3. **Degraded decision quality** — quests go uncompleted and trades lose money more often than the autopilot used to produce, even though no recent balance/policy regression was found in the trade/quest decision code itself.

This plan fixes (1) and (2) with concrete, minimal code changes, and investigates (3) via a targeted re-examination of a known, previously-unresolved live-only bug (see Context) rather than re-tuning the (already heavily-tuned, unregressed) trade/quest heuristics.

## Context (from discovery)

### Issue 1 — spurious disengagement (reclaim-on-input false positive)

- `src/tests/playtest/letsplay/AutopilotController.ts:122-158` — `makeDefaultInputSource`: attaches `pointerdown`/`keydown`/`wheel`/`touchstart` listeners on `window` with no target/isTrusted filtering. The *first* such event anywhere disengages the autopilot (`start()`/`stop()` wiring at `:280-316`).
- `src/presentation/SpaceFlightScene.ts:582` — flight camera wires its own wheel-zoom directly on `window`.
- `src/presentation/SpaceFlightScene.ts:1056-1071` — `onWheel()` calls `event.preventDefault()` but **never `stopPropagation()`**, so the event still bubbles to the autopilot's `window`-level listener.
- `src/presentation/StarMapScene.ts:185` — same pattern, canvas-level wheel zoom that also bubbles to `window` uncontained.
- `src/tests/playtest/letsplay/installAutopilotHook.ts:143-156` — `tick()` already special-cases two "self-inflicted" disengage races (help-panel dismiss, NPC/SOS modal dismiss) by closing them *programmatically* instead of letting a real click reach `window`. Two more blocking-modal registries are **not** mirrored here: `FlightHud.ts:592-606` (`hud.closeModals()` — quest journal + accessibility panel) and `PlanetManager.ts:367-374` (`closeInfoPanel()`).

**Root cause:** any ordinary mouse-wheel zoom gesture while watching the autopilot fly — not a control input — disengages it, because the scene's zoom handlers never stop the event from bubbling to the autopilot's window-level reclaim listener.

### Issue 2 — flee-jump exit/entry geometry mismatch

- `src/utils/flightGeometry.ts:41-63` — `warpEdgePoint(ship, center, exitVector, boundaryRadius, fromMidSystem)`. With `fromMidSystem: true` (a genuine flee), the exit point is the boundary point *nearest the ship's current position* — deliberately **not** in the direction of the target system (documented intentionally at `:24-39`).
- `src/presentation/StarMapScene.ts:1338-1352` — `performWarpJump()`: for a **routine** (non-flee) jump, `exitVector` is a real unit vector from the origin system's map coordinates toward the target's map coordinates. This path is geometrically correct — confirmed no bug here.
- `src/presentation/SpaceFlightScene.ts:524-547` — origin-side exit-point computation: `warpEdgePoint(..., wasFleeing)`, where `wasFleeing = lastFlightWasFleeing` (set from `combatModule.isActive` at the moment the star map was opened, `SpaceFlightScene.ts:1709-1719`).
- `src/presentation/SpaceFlightScene.ts:1431-1487` — `performWarp()`, fired on arrival at the final waypoint. **Bug site:** `:1483` — `entryVector` is computed as `{ -exitVector.x, -exitVector.y }`, i.e. always mirrored from the **original straight-line** `exitVector` toward the target — even when the ship actually departed from a near-edge point that has nothing to do with that direction.
- `src/presentation/flight/warpHeading.ts:1-16` — `arrivalHeadingFromExitVector`, consumes whatever `entryVector` it's given; not itself buggy, just downstream of the bad input.
- Commit `feaaf22` (2026-07-09) already narrowed *when* the near-edge path fires (from "every hyperjump" to "only genuine flees"), per its own message: this made entry/exit "feel wrong (always from one point instead of the far system's projected direction)" — but did not reconcile the entry-vector calculation with the actual near-edge exit angle. That reconciliation is this plan's Task 2.

**Root cause:** `performWarp()`'s destination entry-vector calculation ignores the *actual* exit angle used when the near-edge flee path fired, always falling back to the stale straight-line vector toward the target.

**Chosen fix (Option A, user-selected — minimal):** derive `entryVector` from the real exit point relative to the origin system's center (i.e. mirror the *actual* departure angle), instead of from the straight-line `exitVector`, whenever the near-edge path was used. The routine (non-flee) jump path is unaffected since its exit point *already equals* the straight-line direction.

### Issue 3 — degraded quest/trade quality

- No commit to `MemoryHeuristicPolicy.ts`, `engineQueries.ts`, `TradeSystem.ts`, or `LiveApplier.ts` more recent than 2026-07-07; no stale-relative-to-newer-balance-change mismatch found (`LOCAL_DELIVERY_REWARD_MARGIN`/`ARTIFACT_DROP_CHANCE` last touched 2026-06-25, *before* the quest-viability filter was tuned). No regression found in the decision logic itself.
- `docs/plans/completed/20260706-three-year-campaign.md:1386-1400` — **F9 (still open, CRITICAL)**: the live `land()` executor can silently no-op (freeze for many ticks) when re-targeting a *second* planet in the same system right after take-off. Investigated 2026-07-07, reproduced **only in real live play**, never independently fixed; explicitly deferred "to a follow-up session with real-browser access."
- `src/tests/playtest/letsplay/engineQueries.ts:439-460` — `sellAllCargo()` has **no** margin/breakeven check by design — realizes whatever price is on offer.
- `src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts:1388-1406` — `cut-stale-loss`: intentionally dumps held cargo "at whatever price this market offers" once the agent is stuck (documented trade-off, not a bug).
- **Hypothesis:** F9 forces the ship to stall mid-route (unable to reach a second planet), which stalls quest delivery until the ~40-day deadline expires *and* forces the by-design `cut-stale-loss`/unconditional `sellAllCargo` fallbacks to fire far more than intended — producing exactly "quests don't complete" + "trades at a loss" without any change to the decision logic itself.
- Also worth checking live: whether `neuralEnabled` is on (`localStorage("neuralEnabled")`, default off, `src/systems/settings/gameSettings.ts:138-150`) — if so, a separately documented unresolved `PLANET↔TRADE` no-op collapse in the neural policy (`docs/plans/completed/20260706-three-year-campaign.md:1082-1098`) is an independent candidate.

## Development Approach

- **Testing approach**: TDD — write a failing regression test reproducing each bug before fixing it, per this project's standing bug-fixing process (root CLAUDE.md → "Bug Fixing Process").
- Complete each task fully (red test → fix → green → verify) before moving to the next.
- Make small, focused changes — no refactor bundled into any of these fixes.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task.
- **CRITICAL: all tests must pass before starting next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Issue 3's fix (if F9's root cause is found and is fixable in this codebase) follows the same TDD process; if it can only be confirmed via real-browser play (per its own prior investigation history), that verification is Post-Completion, not a task checkbox.

## Testing Strategy

- **Unit tests**: for the wheel-zoom disengage fix (`AutopilotController`/scene wheel-handler interaction) and the flee-jump entry-vector fix (`SpaceFlightScene.performWarp`/`flightGeometry` math) — required for every task.
- **Real-engine playtest tests** (`src/tests/playtest/**`, boots the real `GameEngine`): used for Issue 2's end-to-end exit→jump→entry verification and for Issue 3's `land()` re-targeting investigation, per this project's convention that wiring/integration bugs belong in the real-engine tier, not a mocked unit test.
- **E2E tests**: not required unless Task 3's investigation surfaces a UI-interaction-only bug (per prior F9 history, plausible) — if so, add a Playwright regression in `playtest-regression.spec.ts` rather than relying on a real-engine test that can't see it.
- No project e2e coverage exists for the autopilot itself (dev-only feature) — if Task 3 needs live-browser confirmation, that step is Post-Completion.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update this plan if implementation deviates from original scope (especially likely for Task 3, given F9's history of resisting headless reproduction).
- ⚠️ **Task 3 (2026-07-12): F9 re-investigated, still not independently fixed — new leading hypothesis, needs live-browser confirmation.** Static re-trace ruled out stale `routeTargetPlanetId`/`plannedRoute` state (scene is always destroyed/recreated on take-off) and ruled out an async `currentSceneType`-vs-`currentScene` race (blocked by `AutopilotController.tickOnce()`'s `busy` re-entrancy guard). New hypothesis not yet ruled out: `GameEngine.gameLoop` drives ship movement off `requestAnimationFrame` (throttled/paused by real browsers on tab/window backgrounding), while the autopilot's poll loop is `setInterval`-backed and keeps firing regardless — a backgrounded tab during live play would stall the ship while the autopilot keeps observing "unmoved" for several ticks, matching the reported "froze for 8 consecutive ticks." Structurally unreproducible in any headless/mocked test (no real rAF/tab-visibility semantics in Vitest). See Task 3's checkboxes above for the full trace and the Post-Completion section for the live-browser confirmation recipe.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation updates — automatable by the agent.
- **Post-Completion** (no checkboxes): live-browser verification of the wheel-zoom fix and flee-jump geometry fix in actual play, and — if Task 3 doesn't reproduce statically/headlessly — the deferred live-browser F9 investigation itself.

## Implementation Steps

### Task 1: Fix wheel-zoom stealing autopilot control

- [x] Write a failing test: engage the autopilot's reclaim-on-input listener (`AutopilotController`'s `makeDefaultInputSource` or an equivalent real-engine harness setup), dispatch a `wheel` event through `SpaceFlightScene`'s camera-zoom handler exactly as a real gesture would, assert the autopilot is **still engaged** afterward (currently fails — it disengages).
- [x] Fix `SpaceFlightScene.onWheel()` (`SpaceFlightScene.ts:1056-1071`) to call `event.stopPropagation()` alongside the existing `preventDefault()`, so a handled zoom gesture never reaches the `window`-level reclaim listener. ⚠️ **Scope correction found during implementation:** `onWheel` and the autopilot's default input source both register directly on `window` (the *same* node, not an ancestor/descendant pair) — `stopPropagation()` alone cannot suppress a sibling listener on the same node, and even `stopImmediatePropagation()` alone is order-dependent (it only blocks listeners registered *after* it, and the autopilot's listener persists across scene recreation, e.g. every warp destroys/recreates `SpaceFlightScene` and re-registers `onWheel` *after* an already-engaged autopilot). Implemented instead: `onWheel` is registered with `capture: true` (capture always runs before bubble on the same node, regardless of attach order) and calls `event.stopImmediatePropagation()` on the handled-zoom path — order-independent, robust across warps. `StarMapScene.handleWheel` is on `canvas` (a genuine descendant of `window`), so the plan's original `stopPropagation()` fix applies there unchanged.
- [x] Apply the same fix to `StarMapScene`'s wheel-zoom handler (`StarMapScene.ts:185`) for consistency (same class of bug on the star map).
- [x] Mirror the two missing modal-closing calls into `installAutopilotHook.ts`'s `tick()` (`:143-156`) — `hud.closeModals()` (quest journal + accessibility panel) and `planetManager.closeInfoPanel()` — alongside the existing `npcManager.closeModals()`, so the autopilot doesn't sit silently idle behind an open panel (secondary contributor to "dropped off" reports).
- [x] Write a test confirming camera zoom still visually functions (zoom level actually changes) after adding `stopPropagation()` — the fix must not silently break zooming itself.
- [x] Write tests for the two newly-mirrored modal-close calls (autopilot `tick()` closes each panel type when open, no-ops when closed).
- [x] Run tests — must pass before Task 2.

### Task 2: Fix flee-jump exit/entry vector mismatch

- [x] Write a failing real-engine playtest test: simulate a genuine flee (`combatModule.isActive` at star-map-open time) whose near-edge exit point is **not** aligned with the straight-line direction to the target system, perform the warp, and assert the destination entry point/heading is derived from the **actual** exit angle — not the stale straight-line vector (currently fails). ⚠️ **Scope correction found during implementation:** derives the departure angle from a NEW `pendingWarpExitPoint` field (the real edge point captured when the route is planned via `planWarpEdgeRoute`), not from live `shipPhysics` position at `performWarp()` call time — the pre-existing `warpArrivalHeading.test.ts` calls `performWarp()` directly without ever flying the ship, so a live-position read would have broken that (untouchable) test; falling back to the straight-line `exitVector` when no exit point was captured keeps it green.
- [x] Write a second test confirming the **routine** (non-flee) jump path is unaffected: exit and entry still mirror the straight-line target-direction vector exactly as before.
- [x] Fix `SpaceFlightScene.performWarp()` (`:1431-1487`, bug site `:1483`): compute `entryVector` from the real exit point relative to the origin system's center (the actual departure angle) instead of always negating the original straight-line `exitVector`. For the routine path these are mathematically identical (no behavior change); for the near-edge flee path they now correctly diverge. ⚠️ Extracted the computation to `departureVectorFromExitPoint` (`flight/warpHeading.ts`) and the pending-warp routing block to `planWarpEdgeRoute` (`utils/flightGeometry.ts`) to satisfy the `SpaceFlightScene.ts` ≤1898-line guard (baseline was already at 1901, over budget, before this task's edits).
- [x] Verify `arrivalHeadingFromExitVector` (`flight/warpHeading.ts`) still produces a sane facing given the corrected vector — add/adjust a test if its existing coverage assumed the old (always-straight-line) input. No change needed: the function is a pure `atan2` agnostic to its input's provenance; added new unit tests for `departureVectorFromExitPoint` instead (the actually-corrected computation).
- [x] Run tests — must pass before Task 3.

### Task 3: Investigate the F9 land()-freeze bug (quest/trade degradation root cause)

- [x] Re-read the July 7 investigation notes in full (`docs/plans/completed/20260706-three-year-campaign.md:1386-1400` and surrounding context) to capture exactly what was already ruled out, so this pass doesn't repeat dead ends. Confirmed: a dedicated `RealEngineHarness` probe (real `SpaceFlightScene`, take off then immediately re-target a second habitable planet, retrying `land()` every tick exactly like the autopilot loop) showed `PlayerShipRenderer.finishTakeoff()` unparks physics immediately and synchronously — `isMoving=true` and real position progress on the very next tick, every time, no freeze. Root cause was left as "likely live-only timing (real rAF/DOM scheduling)," explicitly deferred to a follow-up session with real-browser access, not independently fixed.
- [x] Statically re-trace the live `land()` re-targeting path: `PlanetManager`'s land/approach handling, `SpaceFlightScene.onLandOnPlanet`/`routeTargetPlanetId` bookkeeping, and the ship departure→re-approach sequence when a *second* `land` decision fires shortly after take-off from a *first* planet in the same system — looking specifically for state (e.g. a stale `routeTargetPlanetId`, a leftover `plannedRoute`, or a guard condition) that could silently swallow the second land command. ⚠️ **Findings (new this pass):** (1) `GameEngine.transitionTo` (`GameEngine.ts:570-590`) always `destroy()`s the outgoing scene and constructs a fresh `SpaceFlightScene` on take-off (PLANET→SPACE_FLIGHT) — `PlanetManager.routeTargetPlanetId`/`SpaceFlightScene.plannedRoute` cannot leak stale values across that round trip; ruled out as a cause. (2) Considered an async race where `transitionTo` flips `engine.currentSceneType` synchronously (`GameEngine.ts:579`) well before the new scene instance actually replaces `engine.currentScene` (many awaits later) — a live-timed second `land()` call landing in that window would drive the stale, about-to-be-destroyed flight scene's `executeRouteTo` (`installAutopilotHook.ts`'s live `land()` reads `engine.currentScene` structurally with **no** `currentSceneType` guard, unlike `tick()`/`openStarMap()` in the same file, which do check `engine.currentSceneType === SceneType.SPACE_FLIGHT` first). **Ruled out**: `AutopilotController.tickOnce()` (`AutopilotController.ts:325-341`) has a `busy` re-entrancy guard — no second `observe→decide→apply` step can start until the previous `applyLiveAction` (and the `transitionTo` it awaits) fully resolves, so this exact race structurally cannot occur through the live autopilot loop. (3) New hypothesis, **not ruled out and consistent with every known fact**: `GameEngine.gameLoop` (`GameEngine.ts:1687-1702`) drives ship physics/position *and* the proactive landing check inside `SpaceFlightScene.updateShip` off `requestAnimationFrame`, which real browsers throttle or pause on tab/window backgrounding, while the autopilot's own poll loop is `setInterval`-backed (`AutopilotController.ts`'s `defaultScheduler`) and keeps firing on schedule regardless of tab focus. A backgrounded/unfocused browser tab during live play would stall ship movement while the autopilot keeps observing "unmoved, same target" for several ticks in a row — exactly matching the reported "froze for 8 consecutive ticks" symptom — and exactly why it has never reproduced in `RealEngineHarness`'s synthetic `tick(16)` driver or any mocked-controller unit test: neither has a real rAF/`setInterval` split or tab-visibility throttling to trigger it. The codebase already treats tab-backgrounding as a real, live-only condition elsewhere (`registerFlightHideAutosave` / `visibilitychange`→hidden, `src/presentation/flight/playtest-traps.md:235-248`, `src/systems/FlightPositionTracker.ts`) — but nothing today pauses the autopilot's poll (or otherwise keeps it in step with `gameLoop`'s rAF) when the tab backgrounds.
- [x] If a concrete root cause is found: write a failing real-engine playtest test reproducing it... — not applicable this pass: no root cause was found that is both concrete *and* reproducible headlessly (the tab-visibility hypothesis needs a real browser's `requestAnimationFrame` throttling semantics, which Vitest/`RealEngineHarness` do not have — guessing a fix without a red test would violate this plan's own TDD rule).
- [x] If **no** root cause is found via static tracing (matching the July 7 outcome — it was live-only): document the updated findings in this plan's Progress Tracking (⚠️ prefix), and prepare a concrete live-browser verification recipe (exact repro steps: take off, immediately retarget a second planet, observe via `window.__gameEngine`) for the Post-Completion section — do **not** guess-fix without a reproduced root cause. Done — see Progress Tracking below and the fleshed-out Post-Completion recipe.
- [x] Run tests — must pass (or, if Task 3 yields no automatable fix, confirm no regression was introduced by the investigation itself) before Task 4. No production code changed this task (investigation-only); full unit suite (`npm test -- --run`) confirmed green.

### Task 4: Verify acceptance criteria

- [x] Verify Task 1's fix: a wheel-zoom gesture during active autopilot no longer disengages it, and zoom still works. Confirmed — `capture: true` + `stopImmediatePropagation()` regression tests in place for both `SpaceFlightScene` and `StarMapScene`, plus the zoom-still-functions and modal-mirroring tests, all green in the full unit run.
- [x] Verify Task 2's fix: flee-jump entry point now derives from the real exit angle; routine jumps are provably unchanged (byte-for-byte same computed vectors in the non-flee test). Confirmed — `departureVectorFromExitPoint`/`planWarpEdgeRoute` regression tests and the pre-existing `warpArrivalHeading.test.ts` both green.
- [x] Verify Task 3's outcome is documented either as (a) a landed fix with a green regression test, or (b) a confirmed-still-live-only bug with an updated investigation writeup and a Post-Completion verification recipe. Confirmed (b) — Progress Tracking's 2026-07-12 entry documents the tab-visibility rAF hypothesis and the Post-Completion section (below) has the full live-browser repro recipe.
- [x] Run full unit test suite (`npm test -- --run`). Green: 589 files / 5448 tests passed, 12 skipped.
- [x] Run real-engine playtest suite (`npm run test:playtest`). Green: 73 files / 701 tests passed, 9 skipped.
- [x] Run `npm run letsplay:ci` (oracle) to catch any autopilot-visible regression from Tasks 1-2. Green: 7 files / 108 tests passed, no regressions.
- [x] Run linter — all issues must be fixed. `eslint src --ext .ts`: 0 errors, 46 pre-existing `no-explicit-any` warnings in test files (unrelated to this plan's changes) — nothing to fix.

### Task 5: [Final] Update documentation

- [x] Update `.claude/docs/systems/letsplay.md` with the wheel-zoom-disengage fix and the flee-jump entry-vector fix (both are exactly the kind of "live-session finding" this doc already tracks).
- [x] Update `docs/plans/completed/20260706-three-year-campaign.md`'s F9 entry with this plan's investigation outcome (fixed / still-open-with-new-findings), so a future session doesn't re-investigate from scratch.
- [x] If Task 3 did not land a fix, add a short note to root `CLAUDE.md`'s Overmind/autopilot-adjacent section (or wherever most discoverable) pointing at the live-browser verification recipe. Added under the "Letsplay engine (key facts)" section (closer to autopilot-adjacent content than Overmind).

*Note: ralphex automatically moves this plan to `docs/plans/completed/` once all tasks are checked off.*

## Technical Details

- **`entryVector` fix shape** (Task 2): today, `SpaceFlightScene.ts:1483` does
  `const entryVector = { x: -exitVector.x, y: -exitVector.y };`
  using the `exitVector` captured at plan time (straight-line toward target). The fix instead derives it from the ship's actual exit position relative to the origin system's center at the moment of arrival at the boundary — i.e. `normalize(actualExitPoint - originCenter)`, negated for entry. Since the routine path's `actualExitPoint` already equals `originCenter + exitVector·boundaryRadius`, the two formulas coincide exactly for non-flee jumps (no behavior change, verified by Task 2's second test).
- **`stopPropagation()` fix shape** (Task 1): purely additive — one line in each of the two wheel handlers. No change to `preventDefault()`'s existing behavior (still blocks page-level scroll).
- No domain/schema/save changes in any task — all three fixes are presentation/dev-tooling-only.

## Post-Completion

**Manual verification** (if applicable):
- Live-play confirmation that zooming no longer disengages the autopilot (Task 1) — quick manual check via `npm run dev` + backtick.
- Live-play confirmation that a flee-jump's exit/entry now reads as "toward the target system" rather than "from nowhere" (Task 2) — needs an actual combat-then-flee-then-jump sequence, hard to fully judge from a unit test alone.
- If Task 3 does not land an automatable fix: execute the prepared live-browser F9 repro recipe to finally confirm or rule out the tab-visibility hypothesis with certainty:
  1. `npm run dev`, open the game in a real browser tab, start a run, fly to a system with ≥2 habitable planets.
  2. Land on the first planet (via UI click or `` ` `` autopilot), then take off.
  3. Immediately press `` ` `` to engage the autopilot (or, if already engaged, let it pick the second planet) and **switch to another browser tab or minimize the window** for ~10-15 s — the exact condition the hypothesis needs (`requestAnimationFrame` throttled/paused) that no headless harness can produce.
  4. Switch back and check `window.__gameEngine.currentScene?.shipPhysics?.isMoving` / `shipX,shipY` before vs. after backgrounding, and `window.__autopilot`'s step/tick count (via `flag()`/`exportFlags()`) — if `isMoving` stayed `true` with an unchanged position for several autopilot ticks while backgrounded, then resumed moving immediately on refocus, the hypothesis is **confirmed**: the fix is to pause `AutopilotController`'s `setInterval` scheduler (or otherwise skip ticks) while `document.hidden`, mirroring the existing `registerFlightHideAutosave`/`visibilitychange` pattern.
  5. If instead the ship keeps moving smoothly regardless of tab focus, the hypothesis is **ruled out** — re-open the investigation with a fresh angle (e.g. capture the exact live console/`window.__autopilot.exportFlags()` trace at the moment of the next observed freeze) rather than re-guessing.

**External system updates**: none — dev-only feature, no deployment/consuming-project impact.
