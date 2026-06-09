---
# Planet Parallax + UI Click Fix

## Overview

Two user-reported regressions: (1) the planet panorama background is static — it should drift slightly when the mouse moves (subtle parallax); (2) UI clicks break chaotically across scenes — "many buttons just stop working" with no reproducible trigger.

Root cause of the click bug (found during code review): `GameEngine.transitionTo()` tears down a scene by calling only `currentScene.destroy()` and relies on each scene to fully clean the shared `gameLayer`/`uiLayer`. The teardown contract is inconsistent across scenes (some call `clearGameLayer()`+`clearUILayer()`, some destroy a single `mainContainer`, some do only one). Any incomplete `destroy()` leaves interactive PixiJS objects from the previous scene attached on top of the next scene, silently swallowing clicks. The fix is a central, idempotent layer-clear in `transitionTo` as a safety net, plus a per-scene teardown audit.

This plan is sequenced to run AFTER sprint2 (`20260608-sprint2-flight-and-ui-polish.md`) finishes. Sprint2 Task 6 adds drag-pan to the same panorama sprite; Task 3 here reconciles parallax with whatever sprint2 produced (do not duplicate the pointermove wiring).

## Context

- `src/systems/GameEngine.ts` — `transitionTo()` at line 219; scene teardown at lines 231-235 (`this.currentScene.destroy()`), no central layer clear.
- `src/presentation/Renderer.ts` — `clearGameLayer()` (line 47) and `clearUILayer()` (line 55) each remove + `destroy()` every child. Only `gameLayer` and `uiLayer` are added to the stage (lines 36-37); no content is meant to persist across scenes, so clearing both on every transition is safe.
- `src/presentation/PlanetScene.ts` — panorama sprite created in `createUI()` (~line 472-486), added to `gameLayer`, `eventMode="none"`. After sprint2 Task 6 it will be stored as a class field with drag-pan handlers.
- Per-scene teardown audit baseline (run `grep -c clearGameLayer` / `clearUILayer` per file):
  - Clean both layers: PlanetScene, StarMapScene, CombatScene, DialogueScene, GovernmentScene, MainMenuScene, TextQuestScene.
  - Use single `mainContainer.destroy({children:true})` (verified correct, refresh paths destroy-before-recreate): InfoCenterScene, StationScene, InventoryScene, RaceSelectionScene.
  - Mixed/partial — call `clearGameLayer()` AND `mainContainer.destroy()` but never `clearUILayer()`: TradeScene, EquipmentShopScene, WinScene.
- Scenes also add transient overlays OUTSIDE `mainContainer` directly to `uiLayer` — these are the highest leak risk: `PlanetScene.jobBoardPanel` (line 987), toasts, governor dialogue panel.

## Development Approach

- **Testing approach**: Regular (code first, then unit tests + E2E smoke).
- Tasks are independent; do them in order. Complete and verify each before the next.
- Each task lists an exact "Done when" gate. Run `npm run lint && npm test -- --run` after every task; it MUST pass before moving on.
- Changes are surgical — no refactors, no new abstractions, touch only the lines named.
- Run `npm run test:e2e:regression` before the final verify task.

## Implementation Steps

### Task 1: Central layer-clear safety net in transitionTo

**Files:**
- Modify: `src/systems/GameEngine.ts`

- [x] In `transitionTo()`, find the teardown block (around lines 231-235) that reads `this.currentScene.destroy(); this.currentScene = null;`
- [x] Immediately AFTER that block, add `this.renderer.clearGameLayer();` and `this.renderer.clearUILayer();` so both shared layers are guaranteed empty before the new scene is instantiated. Guard with `if (this.renderer)` (the method already throws earlier if renderer is missing, so a plain call is fine).
- [x] Add a code comment: `// Safety net: guarantee no orphaned interactive objects survive a scene's incomplete destroy() (prevents click-swallowing across scenes).`
- [x] Write unit test `src/tests/transitionClearsLayers.test.ts`: build a GameEngine with a mock renderer whose `gameLayer`/`uiLayer` are real PixiJS `Container`s; add a dummy child to each; transition to a scene that adds nothing; assert both layers have `children.length === 0` after the transition (i.e. the stale child was removed). Use existing test setup patterns from `src/tests/` for mocking the renderer/scene factory.
- [x] **Done when**: `npm run lint && npm test -- --run` passes and the new test proves layers are cleared on transition.

### Task 2: Per-scene teardown audit (defense in depth)

**Files:**
- Modify: `src/presentation/TradeScene.ts`, `src/presentation/EquipmentShopScene.ts`, `src/presentation/WinScene.ts`

- [ ] In each of the three scenes' `destroy()`, the cleanup is currently `mainContainer.destroy({children:true})` + `clearGameLayer()` but never `clearUILayer()`. Since `mainContainer` is added to `uiLayer`, add an explicit `this.renderer.clearUILayer();` call in each `destroy()` so UI is fully cleared even if a transient overlay was added outside `mainContainer`. (After Task 1 this is redundant but documents the contract and protects against direct `transitionTo` callers in tests.)
- [ ] Verify each scene's transient overlays are torn down: in `PlanetScene` confirm `closeJobBoard()` (already called in `destroy()` line 448) removes `jobBoardPanel.container` from `uiLayer`; confirm any toast timeout is cleared.
- [ ] Do NOT change the scenes that already clear both layers or that use a single verified `mainContainer` — leave InfoCenterScene/StationScene/InventoryScene/RaceSelectionScene as-is.
- [ ] **Done when**: `grep -L clearUILayer` over TradeScene/EquipmentShopScene/WinScene returns nothing (all three now reference it), and `npm run lint && npm test -- --run` passes.

### Task 3: PlanetScene panorama parallax (reconcile with sprint2 drag-pan)

**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [ ] First READ the current panorama setup in `createUI()` and `initialize()`. Sprint2 Task 6 likely already: (a) stores the panorama as a class field, (b) records `lastPanX`, (c) registers a `stage.on("pointermove", ...)` drag handler. Reuse those fields — do NOT add a second pointermove listener.
- [ ] Add subtle parallax on mouse move (no button held), on top of any drag-pan: store `panoramaBaseX` (the centered X computed at setup) and a constant `PANORAMA_PARALLAX_MAX = 30` (px). In the existing pointermove handler, when NOT dragging, compute `norm = (event.global.x / screenWidth) * 2 - 1` (range -1..1) and set a target `panoramaBaseX + norm * PANORAMA_PARALLAX_MAX`.
- [ ] Apply the target with easing in `update(dt)` so motion is smooth, not jumpy: `panorama.x += (targetX - panorama.x) * Math.min(1, 0.08 * dt * 60)`. Store `targetX` as a class field updated by the move handler. If sprint2 already drives `panorama.x` via drag, only apply parallax easing when the drag flag is false.
- [ ] Clamp the final `panorama.x` so blank edges never show: never let it exceed the existing drag clamp bounds `[-(panorama.width - screenWidth), 0]`.
- [ ] Ensure the pointermove listener is removed in `destroy()` (sprint2 should already do this via `clearGameLayer`/stage `off`; if a stage listener was added, confirm a matching `stage.off("pointermove", ...)` exists).
- [ ] Write unit test `src/tests/planetParallax.test.ts` for a pure helper `computeParallaxTargetX(mouseX, screenWidth, baseX, maxOffset)`: assert center → `baseX`, left edge (mouseX=0) → `baseX - maxOffset`, right edge (mouseX=screenWidth) → `baseX + maxOffset`. Extract this helper as an exported pure function so it is testable without PixiJS.
- [ ] **Done when**: `npm run lint && npm test -- --run` passes; helper test green.

### Task 4: E2E smoke — clicks survive transitions + parallax moves

**Files:**
- Create: `e2e/planet-parallax-click.spec.ts`
- Page object: reuse/extend existing objects in `e2e/page-objects/`

- [ ] Use `applyMockHeavySystems(page)` before `page.goto()` (per CLAUDE.md E2E fixtures) and attach an `ErrorCollector`; call `assertAndDetach()` at test end.
- [ ] Test A (click regression): drive scene transitions via `window.__gameEngine` — go SPACE_FLIGHT → PLANET → TRADE → back → PLANET, then invoke a PlanetScene service handler via `page.evaluate` (use an existing `e2e*` method or the scene's public handler) and assert it succeeds (scene type changes or modal opens) with no JS error. This proves clicks are not swallowed by leftover objects.
- [ ] Test B (parallax): on PlanetScene, read `panorama.x` baseline via `page.evaluate`, call `page.mouse.move()` to the left edge, advance a few frames (`waitForFunction` on the x value changing), assert `panorama.x` decreased from baseline.
- [ ] Test C (post-modal clicks): open the job board panel, close it, then invoke a service handler again — assert it still fires (regression guard for overlay leak).
- [ ] **Done when**: `npm run test:e2e:regression` passes and the new spec passes (`npm run test:e2e -- planet-parallax-click`).

### Task 5: Verify acceptance criteria

**Files:**
- Read only.

- [ ] `npm test -- --run` — all unit tests pass.
- [ ] `npm run test:e2e:regression` — passes.
- [ ] `npm run lint` — 0 errors.
- [ ] Confirm Task 1's central clear is present in `transitionTo` and Task 2's `clearUILayer` calls are present in the three scenes.

## Technical Details

**Central layer clear (Task 1)** — in `GameEngine.transitionTo`, right after the existing destroy block:
```typescript
if (this.currentScene) {
  this.currentScene.destroy();
  this.currentScene = null;
}
// Safety net: guarantee no orphaned interactive objects survive a scene's
// incomplete destroy() (prevents click-swallowing across scenes).
this.renderer.clearGameLayer();
this.renderer.clearUILayer();
```
Safe because no content is meant to persist across scenes in these layers — every scene rebuilds its display tree in `initialize()`. The call is idempotent with each scene's own cleanup.

**Parallax helper (Task 3)** — pure, exported, unit-tested:
```typescript
export function computeParallaxTargetX(
  mouseX: number, screenWidth: number, baseX: number, maxOffset: number,
): number {
  const norm = (mouseX / screenWidth) * 2 - 1; // -1 (left) .. +1 (right)
  return baseX + norm * maxOffset;
}
```

## Post-Completion

**Manual verification:**
- Land on a planet; move the mouse slowly left/right — the panorama drifts subtly (~30px each way), smoothly, never showing blank edges.
- Cycle scenes repeatedly (flight → planet → trade → equipment → info center → back). Every button must remain clickable after every transition.
- Open and close the job board / governor dialogue several times; service buttons must keep responding.

**Separate code-review findings (NOT in this plan — track elsewhere):**
- `DialogueSystem.startDialogue` stores sessions under `dlg_<npcId>_<timestamp>` but the history-restore lookup uses `npc.id`; keys never match, so history is never restored and `sessionHistory` grows unbounded (memory leak). Fix: key the map by `npc.id`, or store both and prune.
- Duplicate stub classes: `T5DialogueAdapter`/`GRUEmotionAdapter` exist in both `src/ai/adapters/` and inline in `src/systems/DialogueSystem.ts`. Consolidate to one source.
