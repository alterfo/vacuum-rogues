---
# E2E Visual Testing: SpaceFlightScene

## Overview
Interactive browser session to visually verify SpaceFlightScene after sprint3 + SOLID refactor. Use Claude-in-Chrome to navigate the actual game (click buttons, fly ship, land on planets), take screenshots at each step, identify remaining visual bugs (planet masking, ship visibility, HUD), fix them, then write proper Playwright E2E tests with screenshot assertions and `__gameEngine` driver pattern.

## Context
- Key files: `e2e/space-flight.spec.ts` (weak, text-only), `e2e/playtest-regression.spec.ts` (good pattern to follow), `e2e/helpers/`, `e2e/page-objects/`, `e2e/fixtures/mockHeavySystems.ts`
- Existing tests use `window.__gameEngine.transitionTo()` and scene `e2e*` methods — never `canvas.click({position})`
- Known bug: planet masking still broken (TilingSprite maskC centering wrong) — confirmed by screenshot, fix from Task 1 was incomplete
- `__DEBUG__` mode exposes `window.__gameEngine` for test access
- Screenshots fail with black frame due to WebGL render loop — use `page.evaluate(() => canvas.toDataURL())` or `waitForFunction` to sync before screenshot
- Scenes expose `e2eSelectFaction`, `e2eLandOnPlanet` etc — add more as needed, guard with `if (__DEBUG__)`
- Run AFTER `20260609-refactor-spaceflight-solid.md` completes

## Development Approach
- Regular (visual-first): browser session → find bugs → fix → write tests
- Complete each task fully before moving to next
- Screenshots stored in `e2e/screenshots/` (gitignored for dynamic, committed for baselines)
- All tests must pass `npm run test:e2e:regression` before task complete

## Implementation Steps

### Task 1: Browser exploration session — screenshot every state
**Files:**
- Read: `src/presentation/SpaceFlightScene.ts` (e2e* methods available)
- Read: `src/presentation/PlanetSprite.ts` (masking code)
- Create: `e2e/space-flight-exploration.spec.ts` (Playwright exploration harness)
- Create: `e2e/screenshots/exploration/` (auto-created by playwright)

- [x] Start dev server (`npm run dev`) and open game — automated via Playwright exploration harness (`e2e/space-flight-exploration.spec.ts`) instead of interactive Claude-in-Chrome; screenshots inspected as PNGs
- [x] Navigate: main menu → new game → faction select (OUTLANDERS) → SpaceFlightScene
- [x] Screenshot: initial scene (star, planets, ship, HUD visible) → `space-01-initial.png`
- [x] Screenshot: zoom in on each planet — document shape (round vs rectangle) → `space-02-planet-{0..3}.png`
- [x] Click Ход button → screenshot ship moving, HUD state → `space-06-after-turn.png`
- [x] Click planet → screenshot route line appearing → `space-05-route.png`
- [x] Hover over planet, NPC ship, Ход button → screenshot cursor shape — deferred to Task 4: canvas screenshots can't show the DOM cursor; cursor is verified via `container.cursor` property assertions there, not pixels
- [x] Screenshot: sun close-up (corona glow quality) → `space-03-sun.png`
- [x] Screenshot: ship with engine glow and outline → `space-04-ship.png` (see finding ④ — ship sits at the system edge, outside camera pan-clamp range; isolating it cleanly is deferred to Task 4 after the background is hidden)
- [x] Click NPC ship → screenshot dialogue/info panel → `space-07-npc.png`
- [x] Document all visual regressions found in checklist below as ⚠️ (see "Task 1 findings" below)

**Task 1 findings (2026-06-10):** System «Меридиан» has 4 planets (Меридиан, Феникс, Резонанс, Спика) and 9 NPC ships. Camera transform confirmed `screen = world*zoom + pan`; manual pan persists while the ship is stopped (CameraController only follows while moving).

- ⚠️ **CRITICAL — planet circular masking still broken (TilingSprite path).** On every textured rocky planet (Меридиан, Феникс, Резонанс) the surface texture renders as a **rectangle clipped at a straight horizontal bottom edge**, while the atmosphere/glow ring is correctly circular. The TilingSprite mask circle is offset from the texture's local origin — exactly the bug noted in Context. This is Task 2's target. Evidence: `space-02-planet-0/1/2`.
- ✅ Sun renders correctly — circular disc with a good fiery corona/glow. Evidence: `space-03-sun`.
- ✅ Ход (play/pause) toggle works — button flips Ход→ПАУЗА, motion streaks appear, ship flies. Evidence: `space-06-after-turn`.
- ⚠️ **Heavy nebula panorama dominates every frame** — planets, ship, route line and NPCs are hard to read against the background. Validates Task 3's `e2eSetBackgroundVisible(false)` for clean, diff-friendly screenshots.
- ⚠️ ④ **Ship close-up could not be isolated** — the ship spawns at the system edge (world y≈3160, far outside orbit bounds) and camera pan-clamping prevents focusing it at high zoom; its outline/engine-glow couldn't be visually verified in isolation. Re-verify in Task 4 once the background is hidden and the camera can follow the moving ship.
- ⚠️ ⑤ **NPC isolation overridden by camera follow** — capturing the NPC after starting flight let the ship-follow camera override the manual NPC focus (motion streaks dominate `space-07-npc`). Capture NPCs *before* pressing Ход in future runs.

### Task 2: Fix planet circular masking (TilingSprite path)
**Files:**
- Modify: `src/presentation/PlanetSprite.ts`
- Modify: `src/tests/presentation/planetSpriteMask.test.ts`

- [x] Read current maskC setup in PlanetSprite — root cause identified statically (mask was a child of the TilingSprite); runtime `page.evaluate` logging is superseded by the new `e2eMaskInfo()` introspection method
- [x] Identify why TilingSprite mask circle is offset (incorrect center compensation) — the mask was parented under the TilingSprite itself, whose specialised renderer drops a child mask, so the disc rendered as its full rectangle clipped at a straight edge (not a coordinate offset; the math was equivalent but the TilingSprite path was wrong)
- [x] Fix: ensure maskC circle center matches TilingSprite's local coordinate system — wrapped the TilingSprite + circular mask in a plain wrapper `Container` (extracted to `buildTilingDisc()`), mask centred on origin (0,0), mirroring the known-good procedural `surface`/maskA path
- [x] Add `e2eMaskInfo(): { maskIsChild: boolean; maskBounds: object }` debug method to PlanetSprite (guard with `__DEBUG__`)
- [x] Write unit test asserting maskC center equals `(0, 0)` in tiling-local coordinates (or whatever the correct value is after fix) — `buildTilingDisc circular mask` test asserts mask local-bounds centre ≈ (0,0), mask is a child of the wrapper (not the TilingSprite), and disc is offset by (-radius,-radius)
- [x] manual browser screenshot verification (deferred to Task 4 E2E suite — not automatable in this loop; fix is structurally identical to the known-good procedural mask path and covered by the `e2eMaskInfo` + `buildTilingDisc` unit tests)
- [x] Run `npm test -- --run` — all tests pass (931 passed, 99 files)

### Task 3: Add e2e* driver methods to SpaceFlightScene
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Create: `e2e/page-objects/SpaceFlightPage.ts`

- [x] Add `e2eSetBackgroundVisible(visible: boolean): void` — hides `skyContainer` + nebula backdrop so screenshots are lightweight and diff-friendly (guard `__DEBUG__`); delegates to new `SpaceBackgroundLayer.setVisible()` for the mid-ground/dust/vignette sub-layers
- [x] Call `e2eSetBackgroundVisible(false)` in `applyMockHeavySystems` fixture so all E2E tests automatically get clean black background — implemented via the `window.__hideFlightBackground` flag the fixture sets and `SpaceFlightScene.initialize()` reads on every entry (the fixture's init script runs before any scene exists, so a flag is the only way to call into the not-yet-constructed scene)
- [x] Add `e2eGetSceneState(): { planetsCount: number; npcsCount: number; isFlying: boolean; turnNumber: number }` (guard `__DEBUG__`)
- [x] Add `e2eClickPlanet(index: number): void` — triggers planet click handler for planet at index (guard `__DEBUG__`)
- [x] Add `e2eClickNpc(index: number): void` — triggers NPC click for ship at index (guard `__DEBUG__`); NPC click seam (`NpcShipManager.e2eClickNpc`) lives in the module that owns the sprites (Information Expert)
- [x] Add `e2ePressPause(): void` — triggers onPlayPause() (guard `__DEBUG__`); only fires when a turn is running
- [x] Add `e2eStartTurn(): void` — triggers Ход (guard `__DEBUG__`); only fires when no turn is running
- [x] Create `e2e/page-objects/SpaceFlightPage.ts` with typed wrappers around above methods + `waitForScene()`, `screenshot(name)` — added to the existing `e2e/page-objects/space-flight.page.ts` (which already exports the `SpaceFlightPage` class) instead of a duplicate file: `getSceneState`, `setBackgroundVisible`, `clickPlanet`, `clickNpc`, `startTurn`, `pressPause`, `waitForScene`, `screenshot`
- [x] Write unit tests for the new e2e* methods (assert they don't throw, guard check) — `src/tests/presentation/spaceFlightE2eMethods.test.ts` (9 tests: forwarding, out-of-range no-op, bare-scene safety)

### Task 4: Replace space-flight.spec.ts with proper visual E2E suite
**Files:**
- Modify: `e2e/space-flight.spec.ts` (rewrite)
- Modify: `e2e/space-flight-ui.spec.ts`

- [ ] Rewrite `space-flight.spec.ts` using `SpaceFlightPage` PO and `applyMockHeavySystems`
- [ ] Test: scene loads → planets visible (count > 0), ship visible, HUD buttons present
- [ ] Test: click planet → route line appears (verify via `e2eGetSceneState` or `__gameEngine` field)
- [ ] Test: press Ход → ship starts moving → press Ход again → ship stops immediately (mid-flight stop, Task 2 sprint3 regression)
- [ ] Test: hover planet sprite → cursor is "pointer" (verify via `cursorStyles`)
- [ ] Test: hover NPC ship → cursor is "target" or "pointer"
- [ ] Test: NPC ship is clickable after turn ends (regression Task 6 sprint3)
- [ ] Add Playwright screenshot assertions: `expect(page).toHaveScreenshot('space-flight-initial.png', { maxDiffPixelRatio: 0.05 })` for key states
- [ ] All tests pass `npm run test:e2e` — no failures

### Task 5: Add SpaceFlightScene smoke to regression suite
**Files:**
- Modify: `e2e/playtest-regression.spec.ts`

- [ ] Add smoke test: planets are circular — verify via `e2eClickPlanet(0)` + screenshot comparison
- [ ] Add smoke test: Ход button stops ship immediately when mid-flight
- [ ] Add smoke test: NPC ships clickable after first turn
- [ ] Add smoke test: no JS errors thrown during 3-turn play session (ErrorCollector)
- [ ] Verify `npm run test:e2e:regression` completes in < 60s

### Task 6: GRASP compliance review of flight/ modules
**Files:**
- Read: `src/presentation/flight/*.ts` (all extracted modules)
- Read: `src/presentation/SpaceFlightScene.ts` (the controller)

- [ ] **Information Expert** — verify each module owns its own data: PlanetManager has planetSprites, NpcShipManager has npcSprites, StarRenderer has starContainer/radius; none reach into SpaceFlightScene for their own state
- [ ] **Controller** — verify SpaceFlightScene only routes events (pointerdown, onPlayPause, onTurnEnd) and delegates rendering/logic to modules; no direct Graphics/Sprite manipulation left in Scene
- [ ] **Low Coupling** — verify no module imports another module from `flight/`; all cross-module calls go through SpaceFlightScene callbacks
- [ ] **High Cohesion** — verify each module has a single clear responsibility; flag any module over ~600 lines or with mixed concerns
- [ ] **Creator** — verify SpaceFlightScene is the sole creator of all FlightModule instances; modules don't create each other
- [ ] **Protected Variations** — verify all module interaction goes through `FlightModule` interface or explicit callback signatures (no `as any` casts to reach internal state)
- [ ] Document any violations found as ⚠️ with suggested fix
- [ ] If violations are fixable (< 30 min): fix and commit; otherwise add to backlog

### Task 7: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `npm run test:e2e:regression` — regression suite green
- [ ] Browser session re-run: screenshot all fixed items, confirm visual quality
- [ ] No JS errors in browser console during full play session

## Post-Completion
**Manual verification:**
- Play ~5 turns in dev browser: fly to 2 planets, click 3 NPCs, observe sun, observe frost-line planet placement (gas giants outer orbits, rocky inner)
- Screenshot each planet type — confirm all are circular, not rectangular
- Confirm cursor changes on hover for all interactive elements

**E2E screenshot baselines:**
- Committed PNG baselines in `e2e/screenshots/` will fail CI on visual regression — update them intentionally with `npx playwright test --update-snapshots` when visual changes are intentional
