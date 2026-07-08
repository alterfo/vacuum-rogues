# Space Visual Cleanup

## Overview

The in-flight star-system space (background twinkle stars, nebula clouds, comets, asteroids)
currently reads as muddy and cartoonish, while planets/suns (real WebP art via `pickVariant`)
already look good and are **out of scope**. Four concrete complaints, each tied to a specific
render path:

1. **Cartoonish stars** — background twinkle stars are drawn with an explicit stroked 4-point
   "plus sign" diffraction spike (`SpaceBackgroundLayer.createTwinkleStars`), which reads as a
   flat vector cross rather than a photographic glint.
2. **Muddy brownish-orange blob** — nebula clouds (`SpaceBackgroundLayer.createNebulae`) are
   built from 4 perfectly concentric, uniformly-smooth soft-gradient sprites stacked on top of
   each other. With no internal structure or wisping, this reads as a single undifferentiated
   blur rather than a nebula.
3. **Blurry/muddy comets** — the comet coma (`AsteroidBelt.setupCometVisuals`) reuses the exact
   same generic `softGlowTexture()` blob as the nebula clouds (just two stacked circles), so it
   has the same shapeless, muddy quality and no distinct bright nucleus point.
4. **Angular asteroids** — there are two code paths: a baked, shaded `rockTexture()` sprite
   (intended primary path) and a flat 7-sided polygon `drawAsteroid()` fallback (intended only
   for no-canvas/jsdom environments). The screenshot the user flagged closely matches the flat
   polygon fallback's exact geometry and palette, not the shaded texture — this needs to be
   confirmed live before deciding what to fix.

None of these are `BlurFilter`-based (that was already banned and removed per
`feedback-no-blur-filters-flight` / the `AsteroidBelt.ts`/`SpaceBackgroundLayer.ts` comments) —
the muddiness comes from *uniform, structureless soft-gradient stacking*, not from a live blur.
The fix direction (per user decision) is **new/better canvas-baked procedural textures**, in the
same "bake once via Canvas2D, mount as a cheap tinted Sprite" style `gradientTexture.ts` already
uses for `softGlowTexture`/`dustParticleTexture`/`rockTexture` — no new external art pipeline,
no ComfyUI asset generation.

**Explicitly out of scope:** planets, suns, sun corona/halo (`StarRenderer.buildStarHalo`) —
user confirmed these already look fine and should not be touched.

## Context (from discovery)

- Files/components involved:
  - `src/presentation/gradientTexture.ts` — central canvas-baked texture factory
    (`softGlowTexture`, `dustParticleTexture`, `rockTexture`, `mulberry32`, `ROCK_VARIANT_COUNT`)
  - `src/presentation/SpaceBackgroundLayer.ts` — `createTwinkleStars()` (lines ~388-444),
    `createNebulae()` (lines ~458-620+)
  - `src/presentation/flight/AsteroidBelt.ts` — `setupCometVisuals()` (~215-267),
    `setupAsteroidVisuals()` (~277-290), `drawAsteroid()` fallback (~293-332)
  - Existing tests: `src/tests/presentation/spaceBackgroundLayer.test.ts`,
    `src/tests/presentation/asteroidBelt.test.ts`, `src/tests/presentation/starRenderer.test.ts`
    (no dedicated `gradientTexture.test.ts` yet)
- Related patterns found: every texture factory in `gradientTexture.ts` follows the same shape —
  bake once via `document.createElement("canvas")` + `getContext("2d")`, cache the result, return
  `null` when no 2D context is available (jsdom/unit tests) so callers fall back gracefully. New
  textures must follow this exact contract.
- Dependencies identified: `SpaceBackgroundLayer` and `AsteroidBelt` are both `FlightModule`s per
  `flight/CLAUDE.md` — they don't import each other, all wiring goes through the scene. No
  cross-module changes needed; each file's fix is independent.

## Development Approach

- **Testing approach**: TDD (tests first) — for each new/changed texture-generation function,
  write the test asserting its contract (variant/seed determinism, wrap-around bounds, graceful
  `null` return with no canvas) before implementing the function body.
- Complete each task fully before moving to the next.
- Make small, focused changes — one render-path fix per task, matching the four complaints.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task.
- **CRITICAL: all tests must pass before starting next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Visual changes are impossible to fully verify with `jsdom` unit tests (canvas 2D context is
  unavailable there — every texture factory returns `null` and callers fall back). Per
  `feedback-empirical-probe-debugging`, ground every task in a live screenshot (dev-autopilot /
  letsplay) before *and* after the change — don't trust static code reading alone for whether a
  render path is actually hit in production.

## Testing Strategy

- **Unit tests**: required for every new/changed texture-generation function in
  `gradientTexture.ts` — deterministic seeding, variant-count wrapping, no-canvas graceful
  fallback (`null`). These test the *contract*, not the visual result (jsdom can't render canvas
  gradients meaningfully).
- **Live visual verification**: this is a rendering/aesthetics bug class per root `CLAUDE.md`'s
  three-tier table — screenshot-level, not covered by green unit/E2E tests. Use `npm run dev` +
  the dev-only autopilot (`` ` `` to engage) to fly into a system with asteroids/comets/nebula and
  screenshot the actual live render, both to confirm the diagnosis (Task 1) and to confirm the fix
  (Task 6). Do not claim a visual fix done from code reading alone.
- No E2E/Playwright changes expected — these are flight-scene decorative visuals, not
  interactive/pointer-driven UI.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.

## Implementation Steps

### Task 1: Diagnose live render paths before touching code

- [x] Run `npm run dev`, open the flight scene, engage the dev-only autopilot (`` ` ``) or fly
      manually into a system with an asteroid field/comet, and capture screenshots of: background
      twinkle stars, a nebula cloud near a sun, a comet (may need to wait for one to spawn — check
      `AsteroidBelt` comet spawn cadence), and several asteroids up close.
      ⚠️ Done via a temporary throwaway Playwright spec (real browser, real render, not committed —
      deleted after use) rather than manual `npm run dev` clicking, mirroring the existing
      `letsplay-discovery.spec.ts` diagnostic-harness pattern. Screenshots confirmed, in one
      zoomed-in frame: (a) multiple crisp 4-point plus-sign diffraction-spike stars scattered across
      the background: complaint 1 confirmed live; (b) the nebula rendering as 4 perfectly round,
      evenly-spaced, identically-styled soft green glow circles composing one undifferentiated
      haze: complaint 2 confirmed live; (c) several irregular, softly-shaded rock sprites (not flat
      polygons) in the foreground: rockTexture() confirmed live (see next item); comet coma was not
      caught in-frame directly, but `setupCometVisuals` shares the exact same `softGlowTexture()`
      sprite the nebula uses, so the same muddy round-glow look shown for the nebula blobs applies
      to the comet head as well: complaint 3 confirmed by shared-texture code path. Sun/planet
      visuals (out of scope) also appeared in these shots and look unaffected/fine.
- [x] Add a temporary console/log marker (or breakpoint via a quick throwaway `logger.debug`) in
      `AsteroidBelt.setupAsteroidVisuals`/`drawAsteroid` to confirm at runtime whether `rockTexture()`
      is returning a non-null texture in the live browser (i.e. whether `a.rock` is set and the
      `drawAsteroid` polygon-fallback branch at line ~310 is actually being skipped) — remove the
      temporary logging once confirmed.
      ⚠️ Done without editing production source: the throwaway Playwright spec read
      `asteroidBelt.asteroids[].rock`/`.head`/`.core` directly via `page.evaluate` against the live
      scene graph (equivalent evidence to a temporary log, no source edit needed). Result: all 6
      non-comet asteroids had `rock != null` and both comets had `head != null` / `core != null` —
      `rockTexture()`/`softGlowTexture()` are confirmed live; the `drawAsteroid()` polygon fallback
      is NOT reached in the browser (jsdom/no-canvas only, as the code comments already claimed).
- [x] Compare the captured asteroid screenshot against `rockTexture()`'s shaded-gradient look vs
      `drawAsteroid()`'s flat 7-sided polygon (`0x6b6256` fill, 2 craters) to determine which path
      is rendering in production.
      ⚠️ The close-up asteroid screenshot shows irregular, top-left-lit, softly-shaded rock shapes
      with visible speckle/craters — matching `rockTexture()`'s gradient-and-noise bake, not the
      flat single-colour 7-sided polygon. Confirms `rockTexture()` is the live path.
- [x] Document findings inline in this plan (update the Overview/Task 5 notes with ➕/⚠️ if the
      fallback is confirmed live, since that changes Task 5 from a pure redesign into a bug fix +
      redesign).
      ⚠️ Fallback was NOT confirmed live — `rockTexture()` is the confirmed live path. Task 5 stays
      a pure redesign (increase variant count / jitter / rim-light), no root-cause bug fix needed;
      the polygon fallback only needs to stay non-crashing for the genuine no-canvas case.
- [x] No code changes in this task — investigation only, so no new tests apply.

### Task 2: Redesign background twinkle stars (remove cartoonish cross-flare)

- [x] In `src/presentation/gradientTexture.ts`, add a new baked texture factory
      `starPointTexture(hero: boolean)` following the existing `softGlowTexture` contract (bake
      once per variant via Canvas2D radial gradient, cache by variant, return `null` with no 2D
      context). Bake a tight bright core with smooth falloff; for `hero === true`, additionally
      bake two soft, tapered, low-alpha elongated glints directly into the gradient canvas
      (e.g. via a thin linear gradient stroke drawn at low opacity with blur-free but soft-edged
      falloff) — not a runtime `Graphics.stroke()` line, so it anti-aliases naturally instead of
      reading as a crisp vector plus-sign.
- [x] In `src/presentation/SpaceBackgroundLayer.ts`, replace the `Graphics`-based star construction
      in `createTwinkleStars()` (the `g.circle(...)`/`g.moveTo/lineTo/stroke` block) with a tinted
      `Sprite` of the new `starPointTexture()`, keeping the existing per-star color/size/alpha/
      twinkle-phase logic. Remove the stroked 4-point diffraction spike entirely. Keep the existing
      `Graphics` fallback path only for the no-canvas case (mirror the `rockTexture`/`drawAsteroid`
      null-fallback pattern) so jsdom/unit tests don't crash.
- [x] Write tests for `starPointTexture` (success): returns a `Texture` when a 2D context is
      available for both `hero=true` and `hero=false`, and repeated calls for the same `hero` value
      return the same cached texture instance.
- [x] Write tests for `starPointTexture` (error/edge case): returns `null` gracefully with no 2D
      context (existing jsdom test environment), and `createTwinkleStars()` still populates
      `this.twinkleStars` with the expected count/shape when the texture is `null` (fallback path).
- [x] Run tests — must pass before task 3.

### Task 3: Redesign nebula cloud texture (fix muddy blob)

- [x] In `src/presentation/gradientTexture.ts`, add `nebulaCloudTexture(seed: number)` — bakes ONE
      detailed, wispy cloud shape per seed onto a single offscreen canvas by compositing multiple
      randomly-offset/randomly-sized soft radial-gradient blobs (mulberry32-seeded, same
      determinism pattern as `rockTexture`) at varied alpha, rather than perfectly concentric
      uniform rings. Add fine alpha-noise speckle (same technique as `rockTexture`'s surface
      speckle) for texture. Cache per seed like `rockCache`, with a bounded variant count
      (`NEBULA_VARIANT_COUNT`) so memory stays bounded, mirroring `ROCK_VARIANT_COUNT`.
- [x] In `src/presentation/SpaceBackgroundLayer.ts`, replace the 4-blob concentric stack in
      `createNebulae()` (the `addBlob(cloudR * 2.3, ...)` through `addBlob(cloudR * 0.4, ...)`
      calls) with a single tinted `Sprite` built from `nebulaCloudTexture(seed)`, keeping the
      existing per-system palette selection, squash/rotation, and parallax/breathing-pulse
      animation logic untouched. Keep the existing `Graphics`-stacked-circle fallback for the
      no-canvas case (it already produces a wispier look than the current live path — reuse/adapt
      it rather than deleting it).
- [x] Write tests for `nebulaCloudTexture` (success): returns a `Texture` when a 2D context is
      available, and the same `seed` returns the same cached texture (determinism), while a
      different `seed` returns a distinct cached entry.
- [x] Write tests for `nebulaCloudTexture` (error/edge case): returns `null` gracefully with no 2D
      context, seed wraps correctly onto `NEBULA_VARIANT_COUNT` (mirroring the `ROCK_VARIANT_COUNT`
      wrap test pattern), and `createNebulae()` still builds the expected cloud count when the
      texture is `null`.
- [x] Run tests — must pass before task 4.

### Task 4: Redesign comet coma texture (fix blurry/muddy comets)

- [x] In `src/presentation/gradientTexture.ts`, add `cometHeadTexture()` — bakes a distinct comet
      coma: a sharp, bright pinpoint nucleus (tighter, brighter falloff than `softGlowTexture`'s
      generic core) surrounded by a softer, slightly asymmetric coma (denser on one side to suggest
      solar heating direction), so it reads as a coherent object with a clear bright centre rather
      than a uniform blur. Follow the same cache-once contract as `softGlowTexture`.
- [x] In `src/presentation/flight/AsteroidBelt.ts`, update `setupCometVisuals()` to build the
      `head`/`core` sprites from `cometHeadTexture()` instead of the generic `softGlowTexture()`,
      tuning `HEAD_SCALE`/`CORE_SCALE`/tint constants as needed so the nucleus reads as a bright
      point rather than another soft circle. Leave the dust-tail (`ParticleContainer` +
      `dustParticleTexture`) untouched — the tail isn't part of the "muddy comet" complaint, only
      the head/coma is.
- [x] Write tests for `cometHeadTexture` (success): returns a `Texture` when a 2D context is
      available, and repeated calls return the same cached instance.
- [x] Write tests for `cometHeadTexture` (error/edge case): returns `null` gracefully with no 2D
      context, and `setupCometVisuals()` still falls back to the existing minimal-nucleus
      `drawAsteroid()` path (lines ~301-305) when the texture is `null`.
- [x] Run tests — must pass before task 5.

### Task 5: Fix asteroid render path + redesign rock texture (fix angular asteroids)

- [x] Apply the Task 1 diagnosis: if the flat-polygon `drawAsteroid()` fallback was confirmed to be
      the live render path (not just a jsdom-only fallback), root-cause why `rockTexture()` is
      returning `null` (or why `a.rock` isn't set) in the live browser and fix that root cause first
      — per root `CLAUDE.md`'s regression-first bug-fixing process, this is a real bug, not just an
      aesthetic tweak, if confirmed. ⚠️ mark this sub-step done/not-applicable based on Task 1
      findings before proceeding.
      ⚠️ Not applicable — Task 1 confirmed `rockTexture()` (not the polygon fallback) is the live
      render path in the browser, so there is no root cause to fix here; this stays a pure
      redesign of `rockTexture()` per the next item.
- [x] In `src/presentation/gradientTexture.ts`, redesign `rockTexture()`: increase
      `ROCK_VARIANT_COUNT` for more visual variety, increase silhouette jitter/side-count for a
      less uniformly-round outline, add an edge rim-light highlight pass and more varied crater
      sizes/depths so the shaded 3D read is stronger and unmistakably different from a flat
      polygon at typical on-screen asteroid size.
      ⚠️ `ROCK_VARIANT_COUNT` 8→16; silhouette now 7-11 sides (was fixed 9) with wider per-vertex
      jitter (0.52-1.14×baseR, was 0.66-1.08×); craters now 2-6 (was 2-4) with varied depth/rim
      alpha per crater; added a rim-light pass — a bright-to-dark `createLinearGradient` stroke
      along the silhouette edge — for a faceted lit-edge read.
- [x] Tighten/simplify `drawAsteroid()`'s flat-polygon fallback (lines ~310-332) only as a safety
      net for genuine no-canvas environments — it should never be reachable in a real browser after
      the Task 1 root-cause fix, so no need to make it pretty, just keep it non-crashing.
      ⚠️ No change needed — the existing fallback is already minimal, non-crashing, and confirmed
      unreachable in a real browser (Task 1); left as-is per the "no need to make it pretty" note.
- [x] Write tests for the redesigned `rockTexture()` (success): returns a `Texture` for a range of
      seeds, and seed-to-variant wrapping is correct for the new `ROCK_VARIANT_COUNT`.
      ⚠️ Added to `bakedRockTextures.test.ts`: variant-count floor assertion, a full-range
      distinct-and-cached-per-variant test with wrap-around check, and a rim-light-stroke
      assertion (`createLinearGradient`/`stroke` called).
- [x] Write tests for the redesigned `rockTexture()` (error/edge case): returns `null` gracefully
      with no 2D context, and `setupAsteroidVisuals()`/`drawAsteroid()` still produce a valid
      (even if fallback) visual with no throw.
      ⚠️ Already covered by the existing `rockTexture returns null` test and
      `asteroidBelt.test.ts`'s no-canvas fallback test (`belt.initialize()` doesn't throw and
      mounts zero sprites when both `rockTexture`/`cometHeadTexture` are null) — no new test
      needed since neither behavior changed.
- [x] Run tests — must pass before task 6.
      ⚠️ `npm test -- --run` — 557 files / 5211 tests passed, 0 failed. `npx tsc --noEmit` clean.
      `npm run lint` — 0 errors (46 pre-existing warnings, unrelated). `gitnexus detect_changes`
      (working tree) confirms only `gradientTexture.ts` + `bakedRockTextures.test.ts` changed,
      risk low.

### Task 6: Verify acceptance criteria

- [x] Re-run the live screenshot pass from Task 1 (dev-autopilot / manual flight) for all four
      areas — background stars, nebula near a sun, a comet, and close-up asteroids — and confirm
      each no longer matches the complained-about look (no plus-sign stars, no smooth undifferentiated
      blob, no shapeless comet, no flat angular polygon asteroid).
      ⚠️ Done via a second throwaway Playwright spec (real browser, same pattern as Task 1; deleted
      after use, screenshots not committed). Confirmed live: (1) background stars now read as small
      crisp point-glints scattered across every shot — no stroked 4-point cross-flare visible
      anywhere; (2) the nebula reads as organic wispy pillar-shaped structure (procedural
      `nebulaCloudTexture` cloud + the existing per-family backdrop art), not 4 perfectly round
      concentric glow circles; (3) a comet close-up (`05-comet-1.png`) showed a bright pinpoint
      nucleus with a soft asymmetric coma/tail smear — a coherent bright-centred object, not a
      shapeless blob (a second comet capture missed-framed due to comet drift/cooldown timing in
      the throwaway harness itself, not a product issue — the one successful capture is sufficient
      evidence the new `cometHeadTexture` path renders as designed); (4) asteroid close-ups
      (`04-asteroid-0.png`, `04-asteroid-1.png`) showed clearly irregular, faceted, shaded rock
      silhouettes with visible craters and a lit rim edge — matching `rockTexture()`'s redesigned
      3D read, no flat single-colour polygon anywhere.
- [x] Verify sun/planet visuals are visually unchanged (out-of-scope areas untouched) via the same
      screenshot pass.
      ⚠️ `02-sun.png`/`03-planet.png` captured — real WebP star/planet art renders identically to
      the Task 1 baseline shots, untouched by any of the Task 2-5 changes.
- [x] Run full unit test suite (`npm test -- --run`) — must pass.
      ⚠️ 557 test files / 5211 tests passed, 0 failed, 12 skipped (pre-existing skips).
- [x] Run `npm run lint` — all issues must be fixed.
      ⚠️ 0 errors (pre-existing warnings only, unrelated to this branch's changes).
- [x] Run `npm run test:playtest` (real-engine playtest gate) — must pass, confirms no wiring
      regression in `SpaceBackgroundLayer`/`AsteroidBelt` module lifecycle.
      ⚠️ Passed.
- [x] Run `gitnexus detect_changes` (compare against `master`) to confirm only the expected
      symbols/files changed (`gradientTexture.ts`, `SpaceBackgroundLayer.ts`, `AsteroidBelt.ts`,
      plus their tests) — no unexpected blast radius.
      ⚠️ Raw compare against `master` reports "critical" risk / 85 changed files — this is the
      `architecture-hygiene` branch's full 25-commit history ahead of `master` (unrelated prior
      work), not something introduced here. Scoped to just this plan's commits
      (`git diff --stat 6e211da^..HEAD`, i.e. from immediately before Task 1 started to now), the
      diff touches exactly `gradientTexture.ts`, `SpaceBackgroundLayer.ts`, `AsteroidBelt.ts`, their
      three test files, and this plan doc — no unexpected blast radius.

### Task 7: [Final] Update documentation

- [ ] Update `src/presentation/CLAUDE.md` / `flight/CLAUDE.md` (or `gradientTexture.ts`'s own
      doc-comments, matching the existing `softGlowTexture`/`rockTexture` comment style) to
      describe the new `starPointTexture`/`nebulaCloudTexture`/`cometHeadTexture` factories and
      why they replaced the previous Graphics/stacked-blob approach — future readers should not
      reintroduce the flat cross-spike or uniform-blob patterns.
- [ ] Update `docs/plans/` — this file moves to `docs/plans/completed/` automatically once done.

## Technical Details

- All new textures live in `src/presentation/gradientTexture.ts` and follow the existing contract:
  bake once via `document.createElement("canvas")` + `getContext("2d")`, cache the result (module
  `Map`/module-level variable), return `null` when no 2D context exists.
- Determinism: any per-instance variety (nebula clouds, star hero glints) that needs to look
  stable across a session should use the existing `mulberry32(seed)` PRNG pattern seeded from a
  stable id (system id / asteroid seed), matching `rockTexture`'s approach — avoids `Math.random()`
  causing a different look every render.
- No domain/schema/save impact — these are purely presentation-layer rendering changes, no
  persisted state involved.
- No perf regression expected: every new texture is baked once and reused as a cheap tinted
  `Sprite`, the same "zero per-frame cost" model the file's own doc-comments describe replacing
  `BlurFilter` with.

## Post-Completion

**Manual verification** (informational, no checkboxes — already covered by Task 1/6's live
screenshot passes, listed here for completeness):
- Fly through several different systems (different nebula palette families: red/blue/green/teal)
  to confirm the new nebula texture looks good across all four palettes, not just the
  brownish-orange one in the flagged screenshot.
- Confirm comet visuals look right both at spawn and while animating (dust tail direction,
  head/core alignment) across a couple of comet spawns, since comets are transient and easy to
  miss in a single flight.
- Confirm asteroid variety (`ROCK_VARIANT_COUNT` increase) doesn't produce visually-repeating
  clusters in a dense asteroid field.

**External system updates**: none — this is a self-contained presentation-layer change with no
external dependencies or consuming projects.
