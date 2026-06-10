---
# Letsplay Fixes — Regression-First

## Overview
Fix the six findings from the 2026-06-10 letsplay discovery playtest
(`docs/playtests/20260610-letsplay-discovery.md`), strictly following the new
regression-first process (CLAUDE.md "Bug Fixing Process"): every bug first
becomes a red test, then gets fixed, then is visually verified via screenshot.
Headline fix: planets render as rectangles in SpaceFlightScene through the
GLSL `PlanetRotationFilter` path — the path the real game actually takes,
which all previous "masking fixes" (TilingSprite fallback) missed.

## Context
- Findings doc: `docs/playtests/20260610-letsplay-discovery.md` (F1–F6 + verified-working list)
- Letsplay harness: `e2e/letsplay-discovery.spec.ts` — full loop with REAL visuals (no `__hideFlightBackground`), soft steps, screenshots into `e2e/screenshots/letsplay/`
- F1 root cause (high confidence): `src/presentation/filters/PlanetRotationFilter.ts` fragment shader treats `vTextureCoord` as normalized [0,1] sprite coords, but PixiJS v8 computes `vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw)`; with a pooled input texture larger than the output frame the coord only reaches `k < 1` → disc clip mis-scaled → circular arc on one side, straight edge on the other (exactly the screenshot signature)
- PlanetScene renders planets circular (different path) — only the flight scene is affected
- jsdom unit tests CANNOT catch shader bugs; only pixel-level browser assertions can
- Environment: e2e needs `NO_PROXY=localhost,127.0.0.1` (an http_proxy intercepts localhost otherwise)
- DialogueSystem history-restore was fixed earlier (keyed by `npc.id`), but `startDialogue` still adds a never-deleted `dlg_<npcId>_<timestamp>` entry per call (`src/systems/DialogueSystem.ts:102`) — residual unbounded growth
- StarRenderer tiling fallback (`mountStarMapSurface`) sets `tiling.mask = maskC` directly on a TilingSprite — same bug class as the fixed planet path (`buildTilingDisc` wraps in a Container); latent mine even if the mesh path is taken in WebGL
- InventoryScene shows legacy `ship.modules` / `player.inventory.modules` (inert system); EquipmentShopScene sells GearCatalog gear (the working system)

## Development Approach
- Regression-first (CLAUDE.md Bug Fixing Process): each task starts by writing a FAILING test that reproduces the bug, then fixes until green, then verifies visually via screenshot where the bug is visual
- Pixel-level assertions for shader/rendering bugs: screenshot a clipped region, assert pixel statistics (e.g. corner of planet bounds ≈ background color) — platform-independent, no PNG baselines in the CI gate
- Complete each task fully before moving to the next; `npm run lint`, `npm test -- --run`, and `npm run test:e2e:regression` must pass before every task completes
- E2E runs require `NO_PROXY=localhost,127.0.0.1` in this environment
- Keep flight-scene logic in `src/presentation/flight/` modules, not in SpaceFlightScene (< 1900-line guard)
- Re-run `e2e/letsplay-discovery.spec.ts` after visual fixes and inspect the PNGs — this is the final arbiter, not unit tests

## Implementation Steps

### Task 1: F1 — Planets render as rectangles (GLSL PlanetRotationFilter)
**Files:**
- Modify: `src/presentation/filters/PlanetRotationFilter.ts`
- Modify: `e2e/playtest-regression.spec.ts`
- Modify: `src/tests/planetRotationFilter.test.ts`

- [x] Write the RED E2E test first in `playtest-regression.spec.ts`: navigate to SpaceFlightScene (mockHeavySystems fixture → black background), focus camera on planet 0 via `e2eSetCameraZoom`/`e2eSetCameraPan`, freeze world, screenshot a clip of the planet's bounding-box corner region (outside the inscribed circle), assert ≥ 95% of pixels are near-black (background). Confirm it FAILS on current code (texture pixels leak into the corner)
- [x] Fix the shader: emit `aPosition` as its own varying (`out vec2 vPos`) in the vertex stage and compute disc-local coords from `vPos` instead of `vTextureCoord` (or normalize: `vTextureCoord * uInputSize.xy / uOutputFrame.zw`); keep `uMapTexture` sampling unchanged
- [x] Verify the red test now passes; verify limb darkening and rim-light are also centred (they used the same wrong coords)
- [x] Update `src/tests/planetRotationFilter.test.ts`: assert the vertex shader declares the new varying and the fragment does not derive disc coords from raw `vTextureCoord` (source-level guard, documents the invariant jsdom can't execute)
- [x] Re-run `e2e/letsplay-discovery.spec.ts` (NO_PROXY set) and INSPECT `lp-04-planet-*.png` — all planets must be circular with real textures
- [x] Run lint + unit suite + regression gate — all green

### Task 2: F2 — Nebula background drowns the game layer
**Files:**
- Modify: `src/presentation/flight/SpaceBackgroundLayer.ts`
- Modify: `src/config/balance.ts`
- Modify: `src/tests/flight/` (matching module test)

- [x] Add a readability dimmer to SpaceBackgroundLayer: full-screen black overlay (or panorama alpha/tint) with strength from a new `BACKGROUND_DIM` constant in `src/config/balance.ts` (start at 0.45; geometry/visual constants live in config per CLAUDE.md)
- [x] Write unit test: dimmer Graphics exists in the layer, alpha matches the config constant, and `destroy()` still leaves `gameLayer.children.length === 0`
- [x] Re-run letsplay spec; inspect `lp-03-flight-initial.png` and `lp-07-route.png` — planets, ship, route line and NPCs must be clearly readable against the dimmed nebula
- [x] Verify the dimmer is NOT mounted when `__hideFlightBackground` hides the background (no double-dark in E2E screenshots)
- [x] Run lint + unit suite + regression gate — all green

### Task 3: F3 — Player ship invisible / camera can't reach it
**Files:**
- Modify: `src/presentation/flight/CameraController.ts`
- Modify: `src/presentation/flight/PlayerShipRenderer.ts` (only if glow/outline proves broken)
- Modify: `src/tests/flight/` (matching module tests)

- [x] Write RED unit test: camera pan clamp must allow centring the ship spawn position (system edge, world y ≈ 3100+) at zoom 3.5 — assert clamped pan equals requested pan for that target
- [x] Fix the pan-clamp bounds in CameraController so the full ship-reachable area (system boundary radius from `SYSTEM_GEOMETRY`) is focusable
- [x] Re-run letsplay spec; inspect `lp-06-ship.png` — ship sprite, outline and engine glow must be visible and centred
- [x] If the ship is still hard to read at default zoom in `lp-03`: add a subtle marker (pulsing ring or brightened outline) in PlayerShipRenderer, gated by zoom level, with a unit test (not needed — ship clearly readable at default zoom in lp-03 after F2 dim + clamp fix; marker skipped)
- [x] Run lint + unit suite + regression gate — all green

### Task 4: F7 — DialogueSystem residual session-map growth
**Files:**
- Modify: `src/systems/DialogueSystem.ts`
- Modify: `src/tests/` (DialogueSystem test file)

- [x] Write RED unit test: call `startDialogue(player, npc)` 10× for the same NPC — `sessionHistory` size must stay bounded (≤ 2 entries per NPC), history still restored across sessions. Confirm it FAILS (currently grows by ~1 per call via timestamped keys) (confirmed RED: map size 11 after 10 calls)
- [x] Fix: on `startDialogue`, delete the previous session's timestamped key (`previous.id`) when re-indexing the NPC, so each NPC holds at most one live session + one npc.id alias
- [x] Verify history-restore still works (existing behaviour: previous messages copied into the new session)
- [x] Update CLAUDE.md "Known unresolved bug" note — describe the remaining state accurately (history-restore fixed earlier; growth fixed now)
- [x] Run lint + unit suite — all green (0 lint errors, 954 unit tests pass)

### Task 5: F4 — Sun seam band + StarRenderer latent TilingSprite mask
**Files:**
- Modify: `src/presentation/flight/StarRenderer.ts`
- Modify: `src/tests/flight/starRenderer.test.ts` (or matching test file)

- [ ] Reproduce: extend the letsplay/exploration spec to capture a tight sun close-up; identify the horizontal band's source (sphere-mesh v-mapping seam vs texture content vs limb mask arc) by toggling layers via `page.evaluate`
- [ ] Fix the identified source (likely v-coordinate wrap/clamp on the sphere mesh or the equirect texture seam row)
- [ ] Unify the tiling fallback with the planet fix: replace direct `tiling.mask = maskC` in `mountStarMapSurface` with the `buildTilingDisc`-style wrapper (mask on a plain wrapper Container) — same bug class as Task 2 of the e2e-visual plan; add unit test asserting the mask parent is the wrapper, not the TilingSprite
- [ ] Re-run letsplay spec; inspect `lp-05-sun.png` — no band artifact
- [ ] Run lint + unit suite + regression gate — all green

### Task 6: F6 — Hide the inert legacy equipment system from the player
**Files:**
- Modify: `src/presentation/InventoryScene.ts`
- Modify: `src/tests/` (InventoryScene test file, create if missing)

- [ ] Decision (recorded): GearCatalog/ShipLoadout is canonical (it already drives speed/derived stats); the legacy `ship.modules`/`inventory.modules` system is inert and must not be player-visible
- [ ] Write RED unit test: InventoryScene renders the ShipLoadout gear (from the working system) and does NOT render legacy `inventory.modules` entries
- [ ] Replace the legacy module slots/list in InventoryScene with a read-only view of the GearCatalog loadout (installed gear + derived stats: hull, shields, speed, evasion)
- [ ] Keep resources/credits section unchanged; do not touch the legacy domain fields themselves (removal is a separate migration task — out of scope)
- [ ] Re-run letsplay spec; inspect `lp-19-inventory.png` — inventory shows the same gear the shop sells
- [ ] Run lint + unit suite + regression gate — all green

### Task 7: F5 — Combat scene layout polish
**Files:**
- Modify: `src/presentation/CombatScene.ts`
- Modify: `src/tests/` (CombatScene test file)

- [ ] Centre the hex grid in the viewport (derive offset from grid bounds and `renderer.app.screen`, not hardcoded pixels)
- [ ] Render player/enemy units as ship sprites (reuse existing ship textures via `texture(key)`) with faction tint, falling back to the current circles if texture missing
- [ ] Write unit test: grid container is centred for a mocked screen size; units use sprite when texture available
- [ ] Re-run letsplay spec; inspect `lp-20-combat.png` — grid centred, units read as ships
- [ ] Run lint + unit suite + regression gate — all green

### Task 8: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green, < 60 s
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=chromium` — all 21 steps ok, 0 JS errors
- [ ] Inspect ALL regenerated `lp-*.png`: planets circular (F1), background readable (F2), ship visible (F3), sun clean (F4), combat centred (F5), inventory canonical (F6)
- [ ] Update `docs/playtests/20260610-letsplay-discovery.md` — mark each finding fixed with the verifying screenshot name

## Post-Completion
**Manual verification:**
- Play 5+ turns in the dev browser with real visuals: fly to 2 planets (circular, readable), find the ship instantly at default zoom, check the sun, open inventory after buying gear in the shop
- Visual screenshot baselines (`space-flight.spec.ts-snapshots/`) will likely need `npx playwright test --update-snapshots` after F1/F2 change the rendering — regenerate intentionally and review the diffs

**External notes:**
- Legacy equipment domain fields (`ship.modules`, `inventory.modules`, EquipmentSystem) remain in the domain/save schema — full removal needs a save migration and is deliberately out of scope here
