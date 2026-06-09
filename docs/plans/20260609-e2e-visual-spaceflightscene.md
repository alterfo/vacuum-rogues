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
- Create: `e2e/screenshots/exploration/` (auto-created by playwright)

- [ ] Start dev server (`npm run dev`) and open game in Claude-in-Chrome
- [ ] Navigate: main menu → new game → faction select (OUTLANDERS) → SpaceFlightScene
- [ ] Screenshot: initial scene (star, planets, ship, HUD visible)
- [ ] Screenshot: zoom in on each planet — document shape (round vs rectangle)
- [ ] Click Ход button → screenshot ship moving, HUD state
- [ ] Click planet → screenshot route line appearing
- [ ] Hover over planet, NPC ship, Ход button → screenshot cursor shape
- [ ] Screenshot: sun close-up (corona glow quality)
- [ ] Screenshot: ship with engine glow and outline
- [ ] Click NPC ship → screenshot dialogue/info panel
- [ ] Document all visual regressions found in checklist below as ⚠️

### Task 2: Fix planet circular masking (TilingSprite path)
**Files:**
- Modify: `src/presentation/PlanetSprite.ts`
- Modify: `src/tests/presentation/planetSpriteMask.test.ts`

- [ ] Read current maskC setup in PlanetSprite — log actual coordinates at runtime via `page.evaluate`
- [ ] Identify why TilingSprite mask circle is offset (incorrect center compensation)
- [ ] Fix: ensure maskC circle center matches TilingSprite's local coordinate system
- [ ] Add `e2eMaskInfo(): { maskIsChild: boolean; maskBounds: object }` debug method to PlanetSprite (guard with `__DEBUG__`)
- [ ] Write unit test asserting maskC center equals `(0, 0)` in tiling-local coordinates (or whatever the correct value is after fix)
- [ ] Verify via browser session: screenshot planets — all must be circular
- [ ] Run `npm test -- --run` — all tests pass

### Task 3: Add e2e* driver methods to SpaceFlightScene
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Create: `e2e/page-objects/SpaceFlightPage.ts`

- [ ] Add `e2eSetBackgroundVisible(visible: boolean): void` — hides `skyContainer` + nebula backdrop so screenshots are lightweight and diff-friendly (guard `__DEBUG__`)
- [ ] Call `e2eSetBackgroundVisible(false)` in `applyMockHeavySystems` fixture so all E2E tests automatically get clean black background
- [ ] Add `e2eGetSceneState(): { planetsCount: number; npcsCount: number; isFlying: boolean; turnNumber: number }` (guard `__DEBUG__`)
- [ ] Add `e2eClickPlanet(index: number): void` — triggers planet click handler for planet at index (guard `__DEBUG__`)
- [ ] Add `e2eClickNpc(index: number): void` — triggers NPC click for ship at index (guard `__DEBUG__`)
- [ ] Add `e2ePressPause(): void` — triggers onPlayPause() (guard `__DEBUG__`)
- [ ] Add `e2eStartTurn(): void` — triggers Ход (guard `__DEBUG__`)
- [ ] Create `e2e/page-objects/SpaceFlightPage.ts` with typed wrappers around above methods + `waitForScene()`, `screenshot(name)`
- [ ] Write unit tests for the new e2e* methods (assert they don't throw, guard check)

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

### Task 6: Verify acceptance criteria
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
