---
# Per-Instance Planet & Star Visual Variety (Regression-First)

## Overview
Make **every planet's backdrop** and **every sun** look distinct, not just
distinct per type. Today the PlanetScene panorama is keyed by planet TYPE
(two ICE worlds share `wilderness_tundra`) and a star's tint/corona/size are
uniform within a `StarType` (two red dwarfs look the same). Add **deterministic
per-instance variation seeded by `planet.id` / `systemId`** — a subtle,
believable hue/brightness/warmth shift on the backdrop and a temperature/corona/
size jitter on the sun — layered on the existing assets and `pickVariant`
spread, so each instance is unique without garish recoloring.

## Context
- Planet backdrop key (just landed, playtest5): `panoramaKeyForPlanet(type, faction)` in `PlanetScene.ts` → per-TYPE only. The panorama sprite is mounted in `createUI` (the F5 light flat-sprite parallax path, ~line 690+); apply a per-`planet.id` `sprite.tint` there.
- Planet SURFACE already varies per id: `pickVariant("planets", prefix, planet.id)` (`PlanetSprite.ts:196`) — keep; this plan is about the BACKDROP + the SUN.
- Star: `StarRenderer.pickStarTexture` already spreads star_maps by `systemId` (`pickVariant("star_maps", prefix, systemId)`, multiple variants per type exist); `starTint()` is per-StarType only and `mountStarMapSurface` tints the sphere/disc with it. Corona/glow/limb are uniform.
- Seed pattern: `new SeededRNG(\`...${id}\`)` (used throughout, e.g. `surf_${planet.id}`). Keep variation subtle and in a believable band — the user wants *distinct*, not *broken/rainbow*.
- Assets: 8 panoramas (5 `*_city` + `wilderness_desert/jungle/tundra`); many `star_maps/*` variants per type. Tinting is the per-instance lever where art is shared.
- Visual fixes are gated on letsplay screenshots, not just unit tests (CLAUDE.md). Interaction/visual verification = real PNGs inspected.
- E2E env: `NO_PROXY=localhost,127.0.0.1`; harness `e2e/letsplay-discovery.spec.ts` (project `letsplay`).

## Development Approach
- Regression-first; visual tasks gated on inspected letsplay screenshots.
- Per-instance variation is a pure, tested helper (e.g. `tintFromSeed(id)` / star jitter) — deterministic (same id → same look) and bounded (stays believable).
- Keep flight logic in `src/presentation/flight/`; dispose any new filters (CLAUDE.md BlurFilter rule).

## Implementation Steps

### Task 1: Per-planet backdrop variation (each planet distinct)
**Files:**
- Modify: `src/presentation/PlanetScene.ts`
- Create: `src/utils/instanceTint.ts` (+ test) — pure `tintFromSeed(seed, opts)` returning a subtle, bounded tint
- Modify: `src/tests/presentation/PlanetScene.services.test.ts`

- [x] Write the RED test: `tintFromSeed(planetA.id)` ≠ `tintFromSeed(planetB.id)` for distinct ids, stable for the same id, and every channel stays within a believable band (e.g. 0.75–1.0 multiplier — no near-black, no neon). Confirm it FAILS (helper absent)
- [x] Implement `tintFromSeed` (SeededRNG → small warm/cool + brightness offsets) and apply it as `panorama.tint` (and optionally the planet-orb tint) keyed by `planet.id`, on top of the type-based key
- [x] Re-run letsplay (extend the planet step to land on ALL planets in the system, capturing `lp-10-planet-<i>.png` each); INSPECT — every planet's backdrop is visibly different, none broken/over-tinted
- [x] Run lint + unit + regression — green

### Task 2: Per-sun variation (each sun distinct)
**Files:**
- Modify: `src/presentation/flight/StarRenderer.ts` (+ matching test)

- [ ] Write the RED test: star appearance params (tint, corona scale, glow intensity) differ across distinct `systemId`s and are stable per id, staying within a believable band around the `StarType` base. Confirm it FAILS
- [ ] Add a per-`systemId` jitter: a small colour-temperature shift around `starTint()`, plus corona/glow scale + intensity jitter seeded by `systemId`; keep `pickStarTexture`'s variant spread
- [ ] Re-run letsplay; capture the sun in the start system and at least one other system (warp or `transitionTo` to a second system), INSPECT — suns look distinct, none broken
- [ ] Run lint + unit + regression — green

### Task 3: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` 0 errors; `npm test -- --run` all pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green, < 60 s
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — all steps ok, 0 JS errors
- [ ] Inspect the per-planet backdrop screenshots (all distinct) and the multi-system sun screenshots (all distinct)
- [ ] Document the variation bands + seed scheme in a short note in the plan/findings

## Post-Completion
**Manual verification:**
- Land on every planet in a system → each backdrop differs and looks natural. Visit 2–3 systems → each sun differs (colour/corona) and looks natural.
- If true art variety is wanted later (distinct panoramas/star maps rather than tints), generate more assets via the ComfyUI pipeline — out of scope here.
