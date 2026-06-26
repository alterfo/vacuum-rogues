---
# Dev-Only Autopilot (Watch the Agent Play the Live Game)

## Overview
A **dev-only** autopilot: in the development build you can hand the live player ship to
our agent and **watch it play the real, rendered game** in real time (instead of the
headless letsplay harness). It reuses the same agent brain — `observe → policy.decide →
apply` — but drives the **live `SpaceFlightScene`/`GameEngine`** and lets the normal
render loop show it. You can reclaim control at any moment.

Hard constraint: **dev-environment only — never in the prod bundle.** The autopilot and
the agent core stay out of `main.ts`'s import graph (gated by `import.meta.env.DEV` /
`__DEBUG__`), and a guard test enforces it. Works **today with the heuristic** policy;
when the BC/RL net lands it's the same toggle, smarter (`HeuristicPolicy` →
`NeuralPolicy`). Bonus: watching the agent play the *rendered* game is the best way to
catch **visual oddities** (the all-yellow suns, missing images) that the headless agent
can't see — feeding the oddity-hunting workflow.

## Context (from discovery)
- **Agent core exists** (`src/tests/playtest/letsplay/`): `observe(engine)`,
  `PlayerPolicy`/`HeuristicPolicy`, the `Action` vocabulary; the headless `PlayerAgent`
  drives the harness. The autopilot is the *live* counterpart of that loop.
- **Live action surface:** `SpaceFlightScene` exposes the player verbs (route/dock/land/
  trade/take-quest/attack/flee) and runs the real game loop; the autopilot dispatches the
  same `Action`s a human would, then lets time pass on the real clock.
- **Dev-only mechanisms:** `import.meta.env.DEV` / `__DEBUG__`; the existing debug hook
  `window.__gameEngine` (per memory `browser-debugging-spacerangers`). The dev-only
  guard pattern + test already exist (`letsplayDevOnly.test.ts`).
- **Reuse, don't fork:** the autopilot imports the shared agent core; only the *live
  applier* + the dev toggle are new. (If the core needs to move out of the test dir into
  a shared dev module, keep it dev-only — not prod.)

## Development Approach
- **Testing approach: TDD.** The **live applier** (Action → which scene call) is pure
  decision logic, unit-tested with a mocked scene (each action kind → the right scene
  method; illegal actions are skipped). The **autopilot controller** (tick cadence,
  start/stop, reclaim-on-input) is tested against a fake scene/clock. The actual
  watching is manual in the dev build.
- **Dev-only is first-class + guarded:** autopilot lives under `src/tests/` or a
  `src/**` module gated so no production module imports it; a guard test asserts it's not
  in the prod graph and `npm run build` is unaffected. No domain/schema/save change.

## Testing Strategy
- **Unit:** the live applier maps each `Action` kind to the correct `SpaceFlightScene`
  call and no-ops illegal ones; the controller observes→decides→applies on its timer,
  stops on demand, and **yields control on the first human input**.
- **Real-engine playtest:** the controller drives a booted engine through several scenes
  with zero logged/thrown errors (headless proxy for the live loop).
- **Guard:** no prod module imports the autopilot/agent core; build unaffected.

## Implementation Steps

### Task 1: Live-scene action applier
**Files:**
- Create: `src/tests/playtest/letsplay/LiveApplier.ts` (+ test)

- [x] Map an `Action` onto live `SpaceFlightScene`/`GameEngine` calls (route to a
      planet/station, land/dock, open trade + buy/sell, take a board quest, attack/flee,
      wait); skip an action that's illegal for the current scene.
- [x] write tests (mocked scene): each `Action` kind → the expected call; illegal action
      is a safe no-op.
- [x] run tests — green.

### Task 2: Autopilot controller (observe→decide→apply on a timer)
**Files:**
- Create: `src/tests/playtest/letsplay/AutopilotController.ts` (+ test)

- [ ] A controller that, while engaged, periodically `observe(liveEngine)` →
      `policy.decide` → `LiveApplier.apply`, paced so the human can follow; `start()`/
      `stop()`; **reclaim-on-input** (any human pointer/key press disengages); shows a
      small "AUTOPILOT" indicator.
- [ ] write tests (fake scene + clock): ticks decide+apply on cadence; `stop()` halts;
      a simulated human input disengages; never throws.
- [ ] run tests — green.

### Task 3: Dev-only toggle / hook
**Files:**
- Modify: `src/main.ts` or a `src/dev/` entry, gated by `import.meta.env.DEV`

- [ ] Wire a **dev-only** way to toggle autopilot: a `__DEBUG__`-gated hotkey and/or a
      `window.__autopilot.start()/stop()` hook attached only in DEV; it instantiates the
      controller over the live scene with the default (heuristic) policy.
- [ ] write a test: in a non-DEV build the hook/toggle is absent.
- [ ] run tests — green.

### Task 4: Enforce dev-only + verify
**Files:**
- Modify/Extend: `src/tests/architecture/letsplayDevOnly.test.ts`

- [ ] Extend the guard: no production module imports the autopilot/agent core; `npm run
      build` produces an unchanged prod bundle (autopilot excluded).
- [ ] full suite + `test:playtest` green; lint clean; build ok.

### Task 5: Documentation
**Files:**
- Modify: `docs/` + `src/presentation/CLAUDE.md`

- [ ] Document the dev autopilot: how to toggle it (DEV hotkey / `window.__autopilot`),
      that it reuses the agent core + reclaim-on-input, is dev-only/guarded, and is the
      preferred way to *watch* for visual oddities.

## Technical Details
- Pure live-applier + controller over the existing agent core; drives prod scene APIs
  but is never imported by prod (dev-gated + guard test). Heuristic now, neural later via
  the same `PlayerPolicy` seam. No domain/schema/save change; prod bundle untouched.

## Post-Completion
**Manual:** in `npm run dev`, toggle «Автопилот» (hotkey / `window.__autopilot.start()`)
→ watch the agent fly, trade, quest, and fight in the real rendered game; click/keypress
to take back control. Use it to eyeball visual oddities (suns, missing art) live.
