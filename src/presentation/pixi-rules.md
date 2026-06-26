# PixiJS 8 Rules & Presentation Conventions (full reference)

Reference file. Not auto-loaded — the slim `CLAUDE.md` in this directory lists the 3
most-hit rules and points here for the complete list.

## PixiJS Input Handling
- **No hardcoded pixel coordinates** for click detection. Use `eventMode = 'static'` + event handlers on interactive objects.
- Position UI in world/relative coordinates, not screen pixels.

## PixiJS Event Handling Rules (CRITICAL)

**Rule 1: Never Set `eventMode='none'` on Containers with Interactive Children**

`eventMode='none'` on a Container **blocks ALL events** for children, even if children have `eventMode='static'`.

```typescript
// ❌ WRONG - breaks all child buttons
uiContainer.eventMode = 'none';

// ✅ CORRECT - omit eventMode (defaults to 'auto')
```

**Use `eventMode='none'` ONLY for**: non-interactive leaf elements (labels, instruction text).
**Never use on**: containers with buttons/interactive children.

**Rule 2: Always Use `event.stopPropagation()` in UI Click Handlers**

```typescript
button.on('pointerdown', (event) => {
  event.stopPropagation(); // CRITICAL — prevents bubbling to stage/gameLayer
  this.openMenu();
});
```

Required for: all UI buttons over gameLayer/stage, planet/entity click handlers, modal dialogs.

**Rule 3: Set `eventMode='none'` on Text Elements Over Clickable Areas**

PixiJS Text defaults to `eventMode='auto'`, blocking clicks underneath.

```typescript
const label = new Text({ text: 'Card Title' });
label.eventMode = 'none'; // Clicks pass through to cardBg
```

**Rule 3a (PixiJS 8): A Container Whose Children Are All `eventMode='none'` Needs an Explicit `hitArea`**

If EVERY child is `'none'`, the event boundary prunes them all — the button becomes **mouse-dead** even though `container.eventMode='static'` and direct handler calls work.

```typescript
// ✅ CORRECT — give the container explicit hit geometry
btn.hitArea = new Rectangle(0, 0, btnW, btnH);
```

Root cause of the 2026-06-10 "every UiButton unclickable" regression. Guarded by `src/tests/presentation/uiButtonHitArea.test.ts` + real-mouse smoke in `playtest-regression.spec.ts`.

**Rule 3b (PixiJS 8): Mouse-Wheel Scroll on a List Must Use a Window-Level Listener, Not a Federated `wheel` Handler**

PixiJS dispatches `wheel` only to the object directly under the pointer; scrollable rows with `eventMode='static'` sit on top of the list backdrop and swallow the event, so a `backdrop.on('wheel')` / `container.on('wheel')` handler never fires. Use the shared helper `attachWheelScroll(onScroll)` from `src/presentation/ui/WheelScroll.ts` — it adds a `{ passive:false }` window listener and returns a detach fn that **must** be called in `destroy()`/close to avoid stacked listeners across scene transitions. Wired into `EquipmentShopScene`, `StationScene`, `InfoCenterScene`, `JobBoardPanel` (`SpaceFlightScene`/`StarMapScene` use their own equivalent window listeners for camera zoom). Pinned by `src/tests/presentation/wheelScroll.test.ts` + `jobBoardScroll.test.ts`.

**Rule 3b caveat — a scene that owns a window-level wheel listener must suppress it while a modal that also wheel-scrolls is open.** `SpaceFlightScene.onWheel` (camera zoom) and an open `ScrollableList` (e.g. the quest journal) both listen on window `wheel`; both fire on one notch. `onWheel` early-returns when `isBlockingModalOpen()` so the map does not zoom underneath the modal you are scrolling. Pinned by the journal-scroll smoke in `playtest-regression.spec.ts` (asserts `camera.zoom` is unchanged after wheeling the open journal).

**Rule 3c (PixiJS 8): Long list panels use the shared `ScrollableList`, not a hand-rolled masked container.** `src/presentation/ui/ScrollableList.ts` is the one masked, wheel-/drag-scrollable list region (built on `attachWheelScroll`). The caller supplies `items` + a fixed `itemHeight` + a `renderItem` callback; it renders **all** rows (never `slice(0, N)` with a dead "+N ещё" overflow label), and owns the mask (`addChild`'d per Rule 5), the tracking `hitArea` (scrolled-out rows stay un-clickable), scroll clamping, and drag. `destroy()` detaches its window wheel listener and **must** be called from the host's `destroy()`. Set `enableWheel:false` when the host scene already drives the wheel through one handler (e.g. `InfoCenterScene.scrollNews` maps wheel + ArrowUp/Down). Set `enableDrag:false` when a dragging `static` content container would swallow a click-through (see `QuestJournalUI` — the F6 modal backdrop relies on non-button content falling through). Adopters: `QuestJournalUI` (active quests), `InfoCenterScene` (news tab). **Still hand-rolled (migration deferred — prefer migrating when you touch them):** `JobBoardPanel`, `EquipmentShopScene`, `StationScene` shop. Pinned by `scrollableList.test.ts`, `questJournalScroll.test.ts`, `infoCenterNewsScroll.test.ts`.

**Rule 3d (modal keyboard convention): Enter confirms / Esc cancels via the shared `bindModalKeys` helper.** Modals/panels each used to bind ad-hoc `keydown` listeners (some closed on Esc, none confirmed on Enter). `bindModalKeys({ onConfirm, onCancel })` from `src/presentation/ui/bindModalKeys.ts` is the one source of truth: a window-level `keydown` mapping Enter→`onConfirm` (the modal's *single* primary action — not multi-button forms), Esc→`onCancel`. It drops OS auto-repeat and ignores keys while a text field is focused, and returns an idempotent detach fn that **must** be called in `destroy()`/close (mirrors `attachWheelScroll`, Rule 3b). Adopters: `DialogueScene` (Enter→first response, Esc→close), `NpcContactPanel` (Esc-only — the talk/trade/attack/scan hail has no single Enter primary). In-flight, `SpaceFlightScene`'s own `flightKeyHandler` Esc cascade also closes the contact panel, so its Esc is doubly-handled but idempotent. Pinned by `bindModalKeys.test.ts` + `modalKeys.integration.test.ts`.

**Rule 4: Distinguish Mouse Buttons in Event Handlers**

Use `event.button`: `0` = left (primary), `1` = middle (pan), `2` = right (context menu).

**Rule 5 (PixiJS 8): Graphics Mask Must Be addChild()'d to the Masked Object**

```typescript
// ✅ CORRECT — addChild BEFORE assigning mask
surface.addChild(maskGraphics);
surface.mask = maskGraphics;
```

**Rule 5 caveat — a `TilingSprite` drops a child mask.** Wrap the `TilingSprite` + mask in a plain wrapper `Container`, offset the TilingSprite by `(-radius, -radius)`, put the origin-centred circular mask on the **wrapper**. See `PlanetSprite.buildTilingDisc()`.

**Rule 5b (PixiJS 8): in a custom Filter, `vTextureCoord` does NOT span [0,1] over the sprite.** The filter input texture is power-of-two pooled. Emit `aPosition` as its own varying (`out vec2 vPos`) and derive geometry from that; set `padding = 0` and `clipToViewport: false`. See `src/presentation/filters/PlanetRotationFilter.ts`. jsdom cannot catch this bug class — only pixel assertions in a real browser can.

**Equirect sphere-mesh texture addressing (`src/presentation/sphereMesh.ts`).** Uses `addressModeU: "mirror-repeat"` and `addressModeV: "clamp-to-edge"`; longitude offset wraps with **period 2**. Check new equirect maps for baked seams before committing. Pinned by `src/tests/presentation/sphereMesh.test.ts`.

**Rule 6: Update Scale-Dependent UI When Changing World Scale**

Checklist: update world coordinates → update minimap scale → update camera zoom bounds → verify absolute-positioned UI → test edge cases (max zoom, edge of map).

**Rule 7: Apply Camera Transforms to Single Parent Container**

```typescript
// ✅ CORRECT — transform gameLayer, not individual objects
this.renderer.gameLayer.scale.set(this.cameraZoom);
this.renderer.gameLayer.x = this.cameraPanX;
this.renderer.gameLayer.y = this.cameraPanY;
```

**Rule 8: If a Fix Creates New Bugs, Revisit the Root Cause**

Anti-pattern "Ping-Pong Fix": Bug A → Fix 1 → Bug B → Fix 2 → ... Diagnose the root cause; treat it once.

**Rule 9: Pass Scene Context Explicitly, Not via Global Flags**

```typescript
// ❌ WRONG - global flag
this.isReentryWithoutJump = true;
await gameEngine.transitionTo(SceneType.SPACE_FLIGHT);

// ✅ CORRECT - modify state BEFORE transition, pass context explicitly
this.player.currentSystemId = target.id;
await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: this.gameEngine });
```

## Scene Lifecycle
- `destroy()` must clean up ALL DisplayObjects, intervals, and null out references. Partial cleanup causes memory leaks.
- Scenes cannot access IndexedDB directly — route through GameEngine → SaveManager. There is no ONNX runtime: AI is the rule-based `FallbackEngine`, and neural policies are tiny pure-TS MLPs confined to the dev-only letsplay engine (`src/tests/playtest/letsplay/`).

## Planet Backdrop Conventions

Playtest5 fix + per-planet surfaces (2026-06-12):
- **`resolvePlanetBackdropKey(planetType, planetId, faction)` in `PlanetScene.ts` is the single resolver** — always call it, never build the backdrop key inline. Checks `surfaces/<biome>_NN` (deterministic per `planetId` via `pickVariantKey`) first, then falls back to `panoramas/<type-or-faction-panorama>`.
- **Backdrops must key on planet TYPE, not just faction** — the playtest5 bug keyed on faction only; adjacent ICE and VOLCANIC planets of the same faction were identical. `WILDERNESS_PANORAMA` + `PLANET_BIOME` maps in `PlanetScene.ts` are the canonical type→key tables; both include all 6 types (ICE, VOLCANIC, GAS_GIANT, TERRESTRIAL, HABITAT, INDUSTRIAL).
- **`surfaces/` category is in `LAZY_PREFIXES`** — use `tex(backdropKey)` for the sync cache check and `loadTextureAsync(backdropKey)` for the lazy path. The old `panoramaTex(key)` call only works for `panoramas/`. Guarded by `src/tests/presentation/PlanetScene.services.test.ts` and `planetSceneBackdrop.test.ts`.
- **No central planet orb / atmosphere glow on the planet screen** (removed 2026-06-24, `docs/plans/20260624-remove-planet-orb-from-planet-screen.md`). `PlanetScene` represents the world by the **surface backdrop only** — it no longer draws a floating `planets/` orb sprite (nor its procedural disc fallback / rotation tick) or the concentric faction-coloured "atmospheric glow" rings. `PLANET_VISUAL_RADIUS` + `planetCY` survive purely as **layout anchors** for the planet-name label, so the name/info/services menu are positioned exactly as before. The `planets/` disc art category is retained — it's still used by the flight scene (`PlanetSprite.ts`). Pinned by `src/tests/playtest/planetScreenNoOrb.test.ts`.
- **Per-planet axial spin: `planetSpin(planetId)` in `PlanetSprite.ts` is the single source.** Pure + seeded (`spin_<id>`, decorrelated from the `surf_`/`moon_` RNGs), returning `{ speed, direction }` where `speed` is longitude-fraction/ms (one rotation per ~12–60 s) and `direction` is an **independent** ~50/50 ±1 draw (so sign is decoupled from magnitude). All three map-backed render paths in `buildEquirectSphere` (GLSL filter, sphere mesh, tiling disc) consume it so a body spins identically whichever path renders it — never re-derive a per-path speed. The tiling-disc path scrolls in texture px/ms, so it multiplies by `TILING_SCROLL_SCALE`. (The art-less procedural fallback in `buildSphere` keeps its own legacy `surf_` spin — it renders only when a type has neither a `planet_maps/` map nor `planets/` disc art.) Pinned by `src/tests/presentation/planetSpin.test.ts`.
