---
# Planets & Moons Keep Rotating During Pause (Pause Is Only for Ships)

## Overview
During pause the sun keeps spinning and comets keep flying, but **planets and their moons freeze** —
their axial spin and moon rotation are gated on the turn running. The player wants pause to apply
**only to ships** (and combat): the ambient solar system should stay alive, so planets and moons keep
rotating like the sun. Fix: ungate planet **axial spin + moon rotation** from `isTurnRunning` so they
advance on real elapsed time during pause, while keeping each planet's **orbital position around the
star** tied to game-days (preserving the deterministic `position = f(gameDays)` invariant).

## Context
- **Root cause:** `src/presentation/flight/PlanetManager.ts` `update(deltaTime, _bgElapsed)`
  (~L143-152):
  - `sprite.setOrbitForDay(getOrbitalDay())` — orbital position, a pure function of game-days
    (frozen when paused, **by design** — chase/intercept + route targeting rely on it; see the
    `orbitalVelocityPerDay` / "pure function of elapsed game days" comments).
  - `if (this.deps.isTurnRunning()) { sprite.update(deltaTime * timeScale); }` — the **cosmetic axial
    spin + moons**, gated on the turn → frozen during pause. This is the bug.
- **Reference (already real-time during pause):** `StarRenderer.update` (sun) and `AsteroidBelt.update`
  (comets) are driven by `deltaTime`/`bgElapsed` unconditionally — that's why they keep moving.
- **Spin source:** `PlanetSprite` axial spin is a per-id seeded rate applied in `sprite.update(dt)`
  (one rotation per ~12–60 s; shared by the GLSL-filter / sphere-mesh / tiling-disc paths); moons
  advance in the same `update` call.
- **Decision (confirmed):** ungate axial spin + moons only; keep orbital position day-tied.

## Development Approach
- **Regression-first / TDD.** `PlanetManager.update` takes injected deps (`isTurnRunning`,
  `getOrbitalDay`, `getShipPhysics`), so it's unit-testable with a fake sprite: assert spin advances
  while paused and `setOrbitForDay` still uses the game-day. Write the failing test first.
- Run `impact` on `PlanetManager.update` before editing; warn on HIGH/CRITICAL. **Do not modify
  existing test assertions** (standing rule); add new tests. Change only the spin gate — leave the
  orbital-position (day-tied) path and the click-disable semantics untouched. No BlurFilter.
- One concern per task; full suite green between tasks; visually verify via screenshot/GIF.

## Testing Strategy
- Unit: with `isTurnRunning()` false, `PlanetManager.update` still advances each sprite's axial spin +
  moons (real-time), and `setOrbitForDay` is still called with the game-day; with the turn running,
  spin scales by `timeScale` as before; the orbital position does not change merely because the turn
  paused/resumed.
- Visual (manual GIF/screenshot): while paused, planets visibly spin and moons orbit, matching the sun.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Ungate planet axial spin + moon rotation from the turn
**Files:**
- Modify: src/presentation/flight/PlanetManager.ts (`update`: advance `sprite.update(...)` every frame
  regardless of `isTurnRunning`; apply `timeScale` only while the turn runs, base 1× while paused, so
  spin always moves; keep `setOrbitForDay` day-tied)
- Create: src/tests/flight/planetSpinDuringPause.test.ts

- [x] axial spin + moons advance every frame (real-time during pause; × `timeScale` while running);
      orbital position stays a function of game-days
- [x] write tests: paused → spin + moons advance; running → spin scales by `timeScale`; orbit position
      unaffected by pause/resume
- [x] run affected tests — must pass before next task

### Task 2: Verify acceptance criteria
- [x] verify Overview: during pause planets spin and moons rotate (like the sun); pause still halts
      ships/NPC/combat; orbital positions remain day-deterministic — verified by
      planetSpinDuringPause.test.ts (spin+moons advance while paused; orbit stays day-tied) and the
      untouched pause path (pauseFreezesTime/waitTurnPause + e2e "Pause mid-flight finishes the day"
      and "incoming attack auto-pauses" all green)
- [x] visually verify via screenshot/GIF that planets + moons rotate while paused — manual
      (skipped: not reliably automatable here — render-loop blocks screenshots and a still frame
      can't show rotation; behavior proven by the unit test that asserts `sprite.update(dt)` advances
      with nonzero dt while paused)
- [x] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean —
      2311 unit tests passed, 25 e2e regression passed, lint 0 errors
- [x] confirm no existing planet/flight test assertions changed — `git show 8bfdc22`: only
      PlanetManager.ts modified + new test added

## Technical Details
- **Spin rate while paused vs running:** drive `sprite.update` by `deltaTime` always; multiply by
  `getShipPhysics()?.timeScale` only when `isTurnRunning()` (so fast-forward still speeds the spin
  during a running turn, but the planet keeps spinning at base rate when paused). Mirrors how the sun
  already animates.
- **Orbital position unchanged:** `setOrbitForDay(getOrbitalDay())` stays as-is — the planet's place on
  its orbit remains a deterministic function of elapsed game-days, so chase-lead (`orbitalVelocityPerDay`),
  route-to-target, and save reproducibility are untouched.
- **Scope:** only the spin gate in `PlanetManager.update` changes; the `isTurnRunning`-driven
  click-disable and the orbital math are left alone (low blast radius).

## Post-Completion
**Manual verification:** pause in a system and confirm planets visibly spin and their moons orbit
(matching the sun and comets), while your ship and NPCs stay frozen; resume and confirm normal play.
