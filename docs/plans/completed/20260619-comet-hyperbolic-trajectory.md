---
# Comets Move on Hyperbolic Trajectories

## Overview
Foreground comets in a star system currently move on **closed ellipses** (they orbit forever). Real
comets on a system flyby follow an **open hyperbolic** path — they sweep in toward the star once and
leave, never returning. Change comet motion in the asteroid/comet field from elliptical orbit to a
hyperbolic trajectory (single pass), so a comet enters at the system edge, curves around the star,
and exits — then a fresh comet spawns later. Asteroids (the non-comet rocks) are unaffected.

## Context
- **Field module:** `src/presentation/flight/AsteroidBelt.ts` — owns drifting asteroids and orbiting
  comets. A comet today carries elliptical orbit params: `orbitA` (semi-major), `orbitB` (semi-minor),
  `orbitAngle` (current angle), `orbitSpeed` (rad/ms), `orbitTilt` (plane rotation). The update loop
  advances `orbitAngle` and respawns the body once it drifts past the field edge
  (`SYSTEM_GEOMETRY.boundaryRadius * 1.1`, ~L212).
- **Geometry helpers:** `src/utils/flightGeometry.ts` (existing flight math) is the home for a pure
  hyperbola parametrization so it can be unit-tested without PixiJS.
- **Distinction:** `comet: boolean` separates comets from drifting asteroids; only the comet branch
  changes. The background decorative comet *streaks* in `SpaceBackgroundLayer` are a separate,
  unrelated effect and are out of scope.

## Development Approach
- **TDD, pure-first.** Add a pure hyperbolic-position function (parameter → world point) in
  `flightGeometry` and test its shape (open curve, closest approach at the focus, asymptotic exit)
  before wiring it into `AsteroidBelt`. **Visual-verify** the motion by screenshot.
- Run `impact` on `AsteroidBelt` and any `flightGeometry` symbol touched before editing.
- **Do not modify existing test assertions** (standing rule); add new tests. Keep asteroid behaviour
  byte-for-byte unchanged — only the comet branch moves to the hyperbola.
- One concern; full suite green at the end.

## Testing Strategy
- Unit: the hyperbola function returns an open trajectory — distance to the star decreases to a single
  perihelion then increases monotonically; the path is not periodic (no return to start); direction
  reverses sign of approach exactly once. Comet spawn sets valid hyperbola parameters (eccentricity
  > 1, a perihelion inside the field, an incoming asymptote at the system edge).
- Visual/E2E: a comet sweeps past the star once and leaves; it does not loop.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Pure hyperbolic-trajectory helper
**Files:**
- Modify: src/utils/flightGeometry.ts (add `hyperbolaPoint(params, t)` and a param builder:
  perihelion, eccentricity > 1, asymptote orientation)
- Create: src/tests/flight/hyperbola.test.ts

- [x] pure function mapping a path parameter to a world point on a hyperbola focused on the star;
      a builder that produces a flyby entering at the field edge with a perihelion inside it
- [x] write unit tests: open (non-periodic) curve; single perihelion (closest approach); eccentricity > 1;
      symmetric incoming/outgoing asymptotes
- [x] run affected tests — must pass before next task

### Task 2: Drive comets along the hyperbola
**Files:**
- Modify: src/presentation/flight/AsteroidBelt.ts (replace the comet branch's elliptical
  `orbitA/orbitB/orbitAngle` advance with the hyperbolic helper; respawn after the comet exits the
  field; leave asteroid drift untouched)
- Create/Modify: src/tests/flight/cometMotion.test.ts

- [x] comets advance along the hyperbola, exit past the field edge, and a new comet spawns later;
      asteroids unchanged
- [x] write tests: a comet's distance-to-star is non-periodic and exits the field; asteroid path
      regression unchanged
- [x] run affected tests — must pass before next task

### Task 3: Verify acceptance criteria
- [x] verify Overview: comets fly a single hyperbolic pass and leave; asteroids behave as before
      (cometMotion.test.ts: open hyperbola e>1, single perihelion, exits field, never loops, fresh
      respawn after cooldown; asteroids stay on unchanged straight-line drift)
- [x] visually verify a comet flyby via screenshot — manual/temporal (single-pass-vs-loop is motion
      over time, which a static screenshot cannot capture; this game also has a known ad-hoc-screenshot
      render-loop limitation). Covered instead by the deterministic motion unit tests + E2E regression
      render coverage (SpaceFlightScene start / 50-input monkey / 3-turn no-JS-errors all green, and
      AsteroidBelt is instantiated there).
- [x] run full unit suite — all green (1992 passed / 231 files); `npm run test:e2e:regression`
      (23/23 passed); `npm run lint` clean (0 errors)
- [x] confirm no existing asteroid/flight test assertions changed (the two plan commits only ADDED
      new test files hyperbola.test.ts + cometMotion.test.ts and touched the comet branch + geometry
      helper; pre-existing asteroidBelt.test.ts / flightGeometry.test.ts untouched and still green)

## Technical Details
- **Hyperbola model:** focus at the star; eccentricity `e > 1`; the comet enters along the incoming
  asymptote near the field edge, reaches perihelion, and departs along the outgoing asymptote. A
  single monotonic path parameter walks entry → perihelion → exit (no wrap-around).
- **Replace, don't extend:** the comet's `orbitA/orbitB/orbitAngle` ellipse fields give way to
  hyperbola params (perihelion distance, eccentricity, asymptote angle, speed). Asteroid fields and
  the field-edge respawn cadence are reused.

## Post-Completion
**Manual verification:** watch a comet in a system — it should curve in toward the star once and fly
out, never settling into a repeating orbit; confirm the ordinary drifting asteroids look unchanged.
