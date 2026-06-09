---
# Planet Parallax + UI Click Audit

## Overview

Two focused fixes for PlanetScene: (1) subtle mouse-driven parallax on the panorama background so it feels alive when the cursor moves, and (2) a systematic audit of every scene's eventMode/stopPropagation setup to eliminate the intermittent click-swallowing bug reported across PlanetScene service buttons and SpaceFlightScene HUD.

## Context

- **Files involved**: `src/presentation/PlanetScene.ts`, `src/presentation/SpaceFlightScene.ts`, `src/presentation/ui/UiButton.ts`, `src/presentation/TradeScene.ts`, `src/presentation/StationScene.ts`, `src/presentation/JobBoardPanel.ts`, `src/presentation/InventoryScene.ts`
- **Panorama sprite**: `PlanetScene.ts:475` — sprite created with `eventMode="none"`, no mouse-move handler, centered at `(w - panorama.width) / 2`
- **Reported bug**: Clicks fail chaotically in PlanetScene (service buttons), SpaceFlightScene (HUD, planets), and elsewhere — no reproducible trigger
- **Known patterns** (CLAUDE.md): `eventMode='none'` on parent containers blocks children; Text defaults to `eventMode='auto'` and blocks clicks beneath; `stopPropagation()` required on all interactive elements above global stage handlers
- **Related plan**: `20260608-sprint2-flight-and-ui-polish.md` Task 6 (panorama pan) overlaps slightly — this plan implements mouse-parallax, the other plan implements drag-pan; they are compatible

## Development Approach

- **Testing approach**: Regular (code first, then unit tests + E2E smoke)
- Complete each task fully before moving to the next
- Changes are surgical — touch only the minimum needed; no refactors or new abstractions
- Run `npm run lint && npm test -- --run` after each task
- E2E regression suite (`npm run test:e2e:regression`) must pass before final task

## Implementation Steps

### Task 1: Mouse-parallax on PlanetScene panorama

**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [ ] Store `panoramaBg` as a class field (currently a local `const panorama`) so `update()` can access it
- [ ] Store `panoramaBaseX` (the initial centered X) and `panoramaMaxOffset` (e.g. `30`) as class fields
- [ ] In `initialize()`, register a `pointermove` listener on `this.renderer.app.stage` that records `this._mouseX` (global X, 0–screenWidth)
- [ ] In `update(dt)`, compute target offset: `(mouseX / screenW - 0.5) * 2 * maxOffset` (maps center→0, edges→±maxOffset), then lerp `panorama.x` toward `panoramaBaseX + offset` with factor `0.05 * dt * 60` for smooth inertia
- [ ] In `destroy()`, remove the pointermove listener to avoid memory leak
- [ ] Write unit test in `src/tests/planetScene.parallax.test.ts`: mock stage, simulate pointermove events, assert panorama.x converges toward expected offset after several update ticks
- [ ] Run `npm run lint && npm test -- --run` — must pass

### Task 2: Audit PlanetScene event handling

**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [ ] List all Graphics/Containers/Sprites added to `uiLayer` or `gameLayer` that have `eventMode` unset (defaults to `'auto'`) — fix any that are non-interactive to `'none'`
- [ ] Verify every interactive element (buttons, backdrop, customs modal) calls `event.stopPropagation()` on `pointerdown`
- [ ] Check `destroy()`: confirm every `pointerdown`/`pointermove`/`pointerup` listener registered on `stage` or `app` is removed
- [ ] Check z-order: confirm no invisible full-screen Graphics/Container sits above service buttons without `eventMode='none'`
- [ ] Fix any violations found in the checklist above
- [ ] Write/update unit test asserting that `PlanetScene.destroy()` removes all stage-level listeners (spy on `stage.off`)
- [ ] Run `npm run lint && npm test -- --run` — must pass

### Task 3: Audit SpaceFlightScene event handling

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Audit all containers/graphics added during `initialize()` that don't explicitly set `eventMode` — fix non-interactive ones to `'none'`
- [ ] Check HUD button creation (back button, quest button, ~line 2295/2324): confirm `stopPropagation()` present
- [ ] Check modal panel backdrops (~line 2437): confirm `eventMode='static'` + `stopPropagation()` on the backdrop
- [ ] Check that planet sprites and orbit rings explicitly have `eventMode='none'` or `'static'` (not defaulting to `'auto'`)
- [ ] Verify `destroy()` cleans up all stage-level listeners registered in this scene
- [ ] Fix any violations found
- [ ] Run `npm run lint && npm test -- --run` — must pass

### Task 4: Audit remaining scenes (TradeScene, StationScene, JobBoardPanel)

**Files:**
- Modify: `src/presentation/TradeScene.ts`, `src/presentation/StationScene.ts`, `src/presentation/JobBoardPanel.ts`

- [ ] In TradeScene: confirm all buy/sell/qty controls call `stopPropagation()`; confirm backdrop `eventMode='static'`
- [ ] In StationScene: audit for any containers without explicit `eventMode` that could intercept clicks
- [ ] In JobBoardPanel: confirm quest-row clicks and accept-button clicks call `stopPropagation()`; confirm no stale listeners after panel hide/show cycles
- [ ] Fix any violations found
- [ ] Run `npm run lint && npm test -- --run` — must pass

### Task 5: E2E smoke — verify clicks and parallax

**Files:**
- Modify or create: `e2e/planet-parallax-click.spec.ts`

- [ ] Add E2E test: navigate to PlanetScene, simulate `pointermove` via `page.mouse.move()`, assert `window.__gameEngine.currentScene.panoramaBg.x` shifts from baseline
- [ ] Add E2E test: click each service button (at least 3) via `page.evaluate(() => scene.e2eClickServiceButton(index))` — assert scene transitions or modal opens without error
- [ ] Add E2E test: open and close a modal in PlanetScene, then click a service button again — assert click still registers (regression for post-modal click loss)
- [ ] Run `npm run test:e2e:regression` — must pass
- [ ] Run `npm run lint` — must pass

### Task 6: Verify acceptance criteria

- [ ] Panorama parallax visible in-browser: mouse at left edge → bg shifts left ~30px; center → no shift; right → shifts right ~30px
- [ ] Service buttons in PlanetScene always clickable after multiple scene transitions
- [ ] HUD buttons in SpaceFlightScene always clickable after entering from planet
- [ ] `npm test -- --run` passes (all unit tests green)
- [ ] `npm run test:e2e:regression` passes
- [ ] `npm run lint` passes with 0 errors

## Technical Details

**Parallax formula** (in `update`):
```typescript
const norm = (this._mouseX / screenW) * 2 - 1; // -1 … +1
const targetX = this.panoramaBaseX + norm * this.panoramaMaxOffset;
this.panoramaBg.x += (targetX - this.panoramaBg.x) * 0.05 * dt * 60;
```
Clamp panorama.x so it never reveals blank space: `panoramaBaseX ± panoramaMaxOffset` must stay inside `[0 - (panorama.width - screenW), 0]`.

**Audit checklist per scene** (quick grep pattern):
```bash
grep -n "eventMode" src/presentation/PlanetScene.ts | grep -v "'none'"
```
Any hit that isn't on a deliberately interactive element is a candidate for `'none'`.

## Post-Completion

**Manual verification:**
- Play through: land on planet → use each service → return to flight → re-land — confirm no click regression
- Move mouse slowly across PlanetScene — parallax should feel subtle and smooth, not jumpy
- Open/close several modals in sequence — buttons must remain responsive throughout

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`*
