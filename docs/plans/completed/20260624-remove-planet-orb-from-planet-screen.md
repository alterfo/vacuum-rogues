---
# Remove the Floating Planet Orb + Glow from the Planet Screen

## Overview
On the planet screen (`PlanetScene`, the surface view above the services menu) a
large planet **orb sprite** floats over the backdrop, ringed by a banded
**"atmospheric glow"** (three concentric faction-coloured discs). The banded glow
reads like faint ghost planets and the orb is redundant with the surface backdrop
behind it — the user wants **both the halo and the orb itself** gone, leaving the
atmospheric backdrop + the planet name/info/services menu.

This is a small, surgical UI removal in one file. The fix deletes the orb (sprite
+ procedural fallback + its rotation tick) and the concentric glow rings, keeps the
backdrop panorama, dark overlay, faction banner, planet name/info and the services
menu exactly as they are, and removes the now-dead helpers. No domain/data change.

## Context (from discovery)
- **File:** `src/presentation/PlanetScene.ts`.
- **Glow rings:** `createUI()` L971–984 — `// Atmospheric glow: concentric
  semi-transparent rings`, three filled `Graphics.circle` discs at
  `PLANET_VISUAL_RADIUS + 22/40/60`, alphas `0.15/0.08/0.03`, faction colour. These
  are the "гадские планеты" ghost rings.
- **Planet orb:** `createUI()` L986–1013 — `pickVariant("planets", prefix, id)`
  sprite at `planetCX/planetCY` (sized `PLANET_VISUAL_RADIUS*2`), with a procedural
  concentric-circle gradient fallback when no art. Stored in `planetOrbSprite`.
- **Orb field + animation:** `planetOrbSprite` field (L333), the slow rotation tick
  in `update()` (L408–409 `this.planetOrbSprite.rotation += …`), and the reset
  `this.planetOrbSprite = null` (L879).
- **Layout anchors that MUST stay:** `PLANET_VISUAL_RADIUS` (L132) and `planetCY`
  (L969) also position the planet **name** label — `nameY = planetCY +
  PLANET_VISUAL_RADIUS + 16` (L1097). Keep them as pure layout constants so the
  name/info/menu do **not** move; only the visible orb + glow disappear (backdrop
  shows through where the orb was).
- **Dead after removal (must be cleaned for `noUnusedLocals`):** `planetCX` (L968),
  `planetTexturePrefix` (L276), `PLANET_FALLBACK_COLORS` (L288), and the
  `pickVariant` import if it has no other use (`pickVariantKey` for `surfaces` is a
  different import and stays). The `planets` art category itself stays — it's still
  used by the flight scene (`PlanetSprite.ts`); only this screen stops referencing it.
- **No existing test** asserts the orb/glow (the "orbit"/"orbital" tests are the
  flight scene). `e2e/screenshots/planet-shadow-task4.png` is a stored planet-screen
  image that will change.

## Development Approach
- **Testing approach: TDD.** This is a scene/wiring (rendering-composition) change,
  so the regression belongs in the **real-engine playtest tier** (per CLAUDE.md):
  boot the real engine into `PlanetScene` (PixiJS stubbed) and assert the orb +
  glow are absent while backdrop + menu remain. Write it red first (fails against
  the current orb-drawing code), then make it green by removing the orb/glow.
- **Blast-radius rule:** run `impact` on `PlanetScene.createUI` before editing;
  the orb is local to this scene (no external callers depend on `planetOrbSprite`).
- Minimal, single-file change. No domain/`schemas.ts`/migration impact, no asset
  deletion (`planets` art is still used elsewhere). Maintain backward compatibility —
  old saves open the planet screen identically minus the orb.

## Testing Strategy
- **Regression test (real-engine playtest, `src/tests/playtest/**`):** open
  `PlanetScene` for an art-backed planet; assert the scene graph contains **no**
  planet-orb sprite and **no** faction-coloured concentric glow rings, and still
  contains the backdrop sprite + the services-menu buttons + the name text. Assert
  zero logged/thrown errors.
- *If `PlanetScene` cannot be booted headlessly in the harness,* fall back to an
  **E2E** assertion in `e2e/playtest-regression.spec.ts` (planet screen renders
  without the central orb) and refresh the stored screenshot.
- **Unit:** the existing pure-helper tests in
  `src/tests/presentation/PlanetScene.services.test.ts` must stay green (untouched —
  they test backdrop-key/services logic, not the orb).

## Progress Tracking
- Mark items `[x]` immediately. Add discovered tasks with ➕, blockers with ⚠️.

## What Goes Where
- **Implementation Steps** (`[ ]`): the code removal + regression test + docs.
- **Post-Completion** (no checkboxes): the manual screenshot eyeball of the planet
  screen.

## Implementation Steps

### Task 1: Regression test — planet screen has no orb or glow rings
**Files:**
- Create: `src/tests/playtest/planetScreenNoOrb.test.ts` (real-engine playtest)

- [x] Boot the real engine into `PlanetScene` for an art-backed planet (PixiJS
      stubbed per the playtest harness); capture the scene graph.
- [x] Assert **no** planet-orb sprite is added (the `planets` disc) and **no**
      concentric faction-glow `Graphics` rings are drawn at `PLANET_VISUAL_RADIUS +
      22/40/60`. Headlessly no art loads, so the orb renders via its procedural
      `Graphics`-disc fallback and the glow rings are `Graphics` discs — the test
      spies on `Graphics.circle` and asserts **no large disc (radius ≥ 100)** is
      drawn (plus no `Sprite` sized `PLANET_VISUAL_RADIUS*2` for the art path).
- [x] Assert the screen still has the backdrop sprite, the planet name text, and the
      services-menu buttons; and that no errors were logged/thrown.
- [x] Mark this test `[x] … (red until Task 2)` — it fails against current code.
- [x] run the playtest suite — confirm this new test is RED before Task 2 (captured
      radii `[218, 236, 256, 196, 156.8, 117.6]` vs expected `[]`).

### Task 2: Remove the orb + glow from `PlanetScene`
**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [x] Delete the "Atmospheric glow: concentric semi-transparent rings" block
      (the `glowAlphas`/`glowRings` loop).
- [x] Delete the planet-body block: the `pickVariant("planets",…)`
      sprite and its procedural fallback; remove the `planetOrbSprite` field,
      its rotation tick in `update()`, and the `planetOrbSprite = null` reset.
- [x] Keep `PLANET_VISUAL_RADIUS` + `planetCY` as layout anchors for the name
      (`nameY`); remove now-dead `planetCX`, `planetTexturePrefix`,
      `PLANET_FALLBACK_COLORS`, and the unused `pickVariant` import (`pickVariantKey`
      for `surfaces` + the `Sprite` import for the panorama both stay).
- [x] Confirm the backdrop panorama, dark overlay, faction banner, name/info, and
      services menu are untouched and correctly positioned.
- [x] run tests — the Task 1 regression is now GREEN; the existing
      `PlanetScene.services.test.ts` stays green (12 tests); `tsc --noEmit` clean
      (no `noUnusedLocals` from the removed helpers); full `test:playtest` green.

> Note: Task 1 (red test) and Task 2 (removal that greens it) were committed
> together because this repo's pre-commit hook runs staged `*.test.ts` files —
> a deliberately-red TDD test cannot be committed on its own, and bypassing the
> hook with `--no-verify` is disallowed. Tasks 3–4 remain separate.

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes` (compared against the orb commit's parent `1b9286f` to isolate
      it on this long-lived branch) — the only code symbol changed is
      `PlanetScene.createUI` in `PlanetScene.ts`; the new test is a new file. (gitnexus
      flags HIGH only because `createUI` sits in 8 "Initialize → X" scene-init flows;
      the change only deletes orb/glow draw calls, not the init contract — full suite
      green confirms.)
- [x] full unit suite green (315 files / 2667 tests); `npm run test:playtest` green
      (14 tests); `npm run lint` clean (0 errors); `tsc --noEmit` exit 0 and
      `npm run build` ok — no `noUnusedLocals` errors from removed helpers.
- [x] E2E fallback path was NOT used — the regression lives in the real-engine
      playtest tier (`src/tests/playtest/planetScreenNoOrb.test.ts`), so no
      `e2e/screenshots/` refresh is needed.

### Task 4: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` (Planet Backdrop conventions) or a short note

- [x] Note that `PlanetScene` no longer draws a central planet orb or atmosphere
      glow — the planet is represented by the surface backdrop only; the `planets`
      disc art remains in use by the flight scene (`PlanetSprite`). (Added to the
      Planet Backdrop Conventions section of `src/presentation/pixi-rules.md`.)

## Technical Details
- Pure UI removal in `PlanetScene.createUI` + `update`. The name/info/menu layout is
  anchored on constants (`planetCY`, `PLANET_VISUAL_RADIUS`) that stay, so nothing
  shifts — only the orb + glow vanish and the backdrop shows through.
- No data, schema, save, or asset changes. The `planets` texture category is retained
  (used by `PlanetSprite` in flight).

## Post-Completion
*Manual — no checkboxes.*

**Manual verification:**
- Open the planet screen on several worlds (settled + wild, art + no-art) → no
  floating orb, no concentric ghost rings; backdrop + name/info/services look clean
  and correctly spaced. Screenshot-verify per the visual-fix rule.
