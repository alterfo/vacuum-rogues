---
# Fix: Customs Quest Restarts After Win / Can't Exit / Surrender Broken

## Overview
Bug: the customs ("таможня") text quest, **after the player wins, restarts** instead of ending;
the player **can't exit** ("невозможно выйти"); and **«Сдаться» (surrender) does nothing**. All three
symptoms point to one root: a completed or abandoned quest fails to cleanly leave `TextQuestScene` —
either `doReturn()` returns to a context that re-launches the same quest, the win terminal never
reaches the finish handler, or completion isn't recorded so the quest is re-offered. Regression-first:
reproduce the win→restart / can't-exit behaviour as a red test, pin the true cause, fix it so a
finished or surrendered quest exits once and does not restart, and verify.

## Context
- **Customs script:** `src/systems/quests/scripts/customs.ts` — terminal nodes `quest_success`
  (`isSuccess: true`) and `quest_failure_*` (`isFailure: true`) have **empty `transitions: []`**; the
  `check_final` node auto-executes `win` (`condition: "money >= 5000"`) → `quest_success`. Registered
  via `src/systems/quests/TextQuestRegistry.ts` (`customsScript`) and driven by `QuestVM`.
- **Scene:** `src/presentation/TextQuestScene.ts` —
  - `handleVmFinished()` (~L501): on `vm.isSuccess()` → `questManager.forceCompleteQuest(...)`, toast,
    then `doReturn()` after 2 s; on failure → "Нажмите «Начать заново»".
  - Right-panel buttons: **«Начать заново»** rebuilds the `QuestVM` + `renderVmLocation()`;
    **«Сдаться»** → `doReturn()` (~L247). `[ Выйти ]` button + Esc also → `doReturn()`.
  - `doReturn()` (~L960): `transitionTo(this.returnScene, { gameEngine, ...this.returnContext })`.
- **Two engines:** `QuestVM` (script quests like customs) vs `TextQuestRuntime` (`runtime.choose`,
  terminal = `nextNode === null`). The customs bug is on the **VM** path.
- **Likely failure points:** `returnScene`/`returnContext` unset or pointing at the quest-giver that
  re-launches customs; the win terminal not invoking `handleVmFinished`; `forceCompleteQuest` not
  marking the quest done so it is re-offered on return; or `doReturn`'s transition rejecting silently
  (the `.catch` only logs).

## Development Approach
- **Regression-first / TDD.** Drive the customs `QuestVM` to the win terminal in a harness and assert:
  the quest is marked complete, the scene returns exactly once, and it does **not** re-enter customs;
  separately assert «Сдаться»/Выйти/Esc each return. The red test must fail for the real reason first
  (per memory: prove it red, confirm the production path).
- Run `impact` on `TextQuestScene.doReturn`/`handleVmFinished`, `QuestVM` terminal handling, and
  `forceCompleteQuest` before editing. **Do not modify existing test assertions** (standing rule); add
  new tests. Keep the fix to the exit/terminal path — don't change unrelated quest behaviour.
- One concern per task; full suite green between tasks; visually verify the customs win→exit.

## Testing Strategy
- Unit/harness: customs VM reaching `quest_success` → `isSuccess()` true and the finish path fires
  once; `forceCompleteQuest` marks it complete (not re-offered); `doReturn` targets a valid
  `returnScene`/context that is not the customs quest; «Сдаться» and the exit/Esc paths all invoke a
  working return.
- Integration: completing or surrendering customs leaves `TextQuestScene` and lands back in the prior
  scene without relaunching the quest.
- E2E/regression (if feasible): win the customs quest and confirm it exits, not restarts.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Reproduce the win-restart / no-exit bug as a red test
**Files:**
- Create: src/tests/quests/customsExit.test.ts

- [x] harness drives the customs `QuestVM` to the win terminal and asserts the quest finishes and the
      scene returns once without re-launching customs; reproduce the restart / can't-exit failure (red)
      for the genuine cause (return target vs terminal-not-finishing vs completion-not-recorded)
      — genuine cause pinned: `PlanetScene.checkAndResumeTextQuest()` (called from `initialize`,
      PlanetScene.ts:355) auto-relaunches the still-active TEXT_ADVENTURE quest; the quest's
      `returnScene` is PLANET, so surrender/Esc/exit/post-win all `doReturn()` → PLANET → instant
      re-launch = inescapable loop.
- [x] add a case asserting «Сдаться»/exit invoke a successful return (Сдаться + Escape cases; both
      also assert the `resumeTextQuest:false` no-resume signal the fix must add)
- [x] confirm the test is red for the real root cause (3 reproductions fail their assertions:
      doReturn carries no no-resume flag; PlanetScene relaunches the active quest)
- [x] run the test — must be RED before the fix (reproductions are `it.fails` so the suite stays
      green for the pre-commit hook without `--no-verify`; Task 2 converts them to plain `it`)

### Task 2: Fix the exit/terminal path
**Files:**
- Modify: src/presentation/TextQuestScene.ts (ensure a success/failure terminal finishes once and
  `doReturn()` exits to a valid prior scene/context that does not re-launch the quest; make
  «Сдаться»/«Выйти»/Esc reliably return) and/or src/systems/quests/scripts/customs.ts /
  the VM terminal handling if the win node never reaches `handleVmFinished`
- Modify (if completion isn't recorded): the `forceCompleteQuest` call path so customs is marked done

- [x] apply the minimal fix for the confirmed cause; the Task 1 test goes green
      — `TextQuestScene.doReturn()` now tags the return context with `resumeTextQuest: false`;
      `PlanetScene` stores it as `suppressTextQuestResume` (from `ctx.resumeTextQuest === false`) and
      `checkAndResumeTextQuest()` early-returns when set, so the immediate return does not relaunch.
      The three Task 1 reproductions were converted from `it.fails` to plain `it` (assertions
      unchanged) and are green.
- [x] ⚠️ if the fix reds an existing quest test, STOP and re-diagnose (don't weaken it)
      — no existing test red'd: 246 quest tests + 392 presentation tests all green; no assertion changed.
- [x] write tests for the adjacent cases (failure terminal exits; surrender mid-quest exits) — all green
      — added "failure terminal exits without re-launching" (failure terminal shows retry, no auto-return,
      then exits to PLANET with `resumeTextQuest:false`); surrender-mid-quest is covered by the «Сдаться»
      case (doReturn called before any terminal).
- [x] run affected tests — must pass before next task — `customsExit.test.ts` 6/6; quests 246/246;
      presentation 392/392; lint 0 errors.

### Task 3: Verify acceptance criteria
- [x] verify Overview: winning customs ends + exits (no restart); «Сдаться» and «Выйти»/Esc exit
      — all three symptoms covered green by `customsExit.test.ts` (6/6): win marks complete + returns
      once with `resumeTextQuest:false`; «Сдаться» and Escape each return with the no-resume flag;
      failure terminal shows retry then exits with no-resume.
- [x] visually verify in-game: complete the customs quest and confirm it returns to the prior scene
      — manual (skipped: not automatable; in-engine screenshots fail in the render loop). Exit behaviour
      is proven by the no-resume assertions in `customsExit.test.ts` + the PlanetScene suppress-resume path.
- [x] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
      — unit 2337/2337 (266 files); e2e:regression 25/25; lint 0 errors (43 pre-existing warnings only).
- [x] confirm no existing quest/scene test assertions changed
      — `git diff ca48033..d41328c` is purely additive (461 insertions, 0 deletions); the only test file
      touched is the new `src/tests/quests/customsExit.test.ts`.

## Technical Details
- **One root, three symptoms:** win-exit, «Сдаться», and «Выйти»/Esc all route through `doReturn()`;
  fixing the return (valid `returnScene`/context, no re-launch) addresses all three. If the win
  terminal also fails to call `handleVmFinished`, fix the VM-terminal detection so a node with empty
  transitions finishes.
- **Completion vs re-offer:** ensure `forceCompleteQuest` actually marks customs complete so returning
  to the giver does not immediately re-offer/auto-enter it (a cause of the perceived "restart").
- **Surface silent failures:** `doReturn`'s transition rejection is only logged; the fix should make a
  failed return observable (so it can't look like a dead "can't exit").

## Post-Completion
**Manual verification:** play the customs quest to a win and confirm it ends and returns you to the
prior scene (no restart); start it again and press «Сдаться» mid-shift, and «Выйти»/Esc, confirming
each cleanly exits.
