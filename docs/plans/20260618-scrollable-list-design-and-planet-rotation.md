---
# Unified Scrollable-List Design (Quest Journal et al.) + Varied Planet Rotation

## Overview
Two unrelated UX bugs, bundled as one playtest batch. **(A) Truncated lists.** The
quest journal shows only the first ~2 active quests and a dead `+N ещё...` label you
can't open — `QuestJournalUI` does `slice(0, maxVisible)` and prints the overflow as
plain text. Several panels have similar ad-hoc "show first N" or raw-scroll handling.
This plan introduces ONE reusable **`ScrollableList`** component (a masked, wheel- and
button/drag-scrollable region built on the existing `ui/WheelScroll`) and applies it
to the journal and the other list panels, so every long list is fully reachable with a
consistent design. **(B) Identical planet spin.** Every planet appears to rotate the
same way at the same speed. The spin IS seeded per planet, but the range is tiny and
extremely slow (`0.00006–0.00012` longitude/ms, ~one turn per 8–17 s), so the variety
is imperceptible. This widens the range to a clearly-visible, well-mixed spread (speed
+ direction, optionally axial tilt) so no two planets look alike.

## Context
- **Truncation:** `src/presentation/QuestJournalUI.ts` L180–193 —
  `maxVisible = floor(...)`, `quests.slice(0, maxVisible)`, `+${overflow} ещё...`
  (non-interactive). Multiple stacked sections (active / pending-return / completed /
  expired) share vertical space, squeezing active quests to ~2.
- **Existing scroll helper:** `src/presentation/ui/WheelScroll.ts` (`attachWheelScroll`)
  shipped by the shop-scroll run and wired into `EquipmentShopScene`, `StationScene`,
  `InfoCenterScene`, `JobBoardPanel`, `MainMenuScene` — but each still hand-rolls its
  masked list + scrollbar. The journal was never migrated.
- **PixiJS mask rule:** mask must be `addChild()`'d to the masked container (see
  `pixi-rules.md`) — the `ScrollableList` clip must follow it.
- **Planet spin:** `src/presentation/PlanetSprite.ts` — `buildEquirectSphere`
  (filter path L319–321), sphere-mesh path (L340–341), tiling fallback (L360); all use
  `new SeededRNG('surf_'+planet.id)` then
  `(0.00006 + rng.next()*0.00006) * (rng.next()<0.5?1:-1)`. `update()` advances via
  `rotationFilter.advance(dt)` / `axialSpeed*dt`. `PlanetRotationFilter`
  (`src/presentation/filters/PlanetRotationFilter.ts`) takes the per-planet speed.

## Development Approach
- **Testing approach: TDD / regression-first.** Pure logic (`ScrollableList` scroll
  math; planet spin distribution) gets unit tests; the journal scroll + planet spin are
  screenshot/e2e-verified (green text tests are not sufficient for visual per repo rule).
- **Orthogonality:** ONE `ScrollableList` consumed by every list panel (no per-panel
  scroll/clip code); planet spin stays a pure seeded function of `planet.id`.
- Do not modify existing test assertions; add new tests. One concern per task.

## Testing Strategy
- Unit: `ScrollableList` content height, offset clamping, wheel/drag delta, item count
  (no truncation); planet spin — two ids give different speed & direction, speeds fall
  in the visible range, a sample of N planets is direction-mixed (not all one sign).
- E2E/regression: a journal with >2 active quests scrolls to reveal them all (no dead
  `+N ещё`); screenshot the journal scrolled. Planet-spin variety is a screenshot check.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep this file in sync.

## Implementation Steps

### Task 1: Reusable `ScrollableList` component
**Files:**
- Create: src/presentation/ui/ScrollableList.ts (masked clip + `attachWheelScroll` +
  optional scrollbar/drag; renders N items via an item-height + item-renderer callback;
  clamps scroll; no truncation)
- Create: src/tests/presentation/scrollableList.test.ts

- [x] render an arbitrary item count into a masked region; expose `scrollBy/scrollTo`
      with clamped offset; wheel + drag supported; mask is `addChild`'d (pixi rule)
- [x] write tests: content height, offset clamp at top/bottom, item count preserved
- [x] run affected tests — must pass before next task

### Task 2: Quest journal uses `ScrollableList` (no `+N ещё` dead-end)
**Files:**
- Modify: src/presentation/QuestJournalUI.ts (replace `slice`/overflow with a
  `ScrollableList` of ALL active quests; sections become scrollable regions)
- Create/Modify: e2e regression spec (journal scrolls to all active quests)

- [x] all active quests reachable via scroll; remove the non-interactive `+N ещё...`
- [x] readable contrast retained (≥ `0xb4b4b4`); screenshot-verify the scrolled journal
- [x] add e2e assertion: with >2 active quests, scrolling reveals them
- [x] run affected tests + regression — must pass before next task

### Task 3: Standardize the other list panels on `ScrollableList`
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts, StationScene.ts, InfoCenterScene.ts,
  JobBoardPanel.ts, MainMenuScene.ts (replace hand-rolled masked-list + scroll with
  `ScrollableList`; keep `WheelScroll` underneath)

- [x] each panel's long list renders through `ScrollableList` (one design everywhere);
      remaining low-traffic lists noted as ➕ follow-up if not migrated here
      → `InfoCenterScene` news tab migrated onto `ScrollableList` (renders ALL
      rows, no `slice`; the component owns mask/hit-area/clamp/drag). Added an
      additive `enableWheel?: boolean` option so the scene keeps its single
      wheel+ArrowUp/Down driver (`scrollNews`) instead of double-binding.
      ➕ Follow-up (deliberately NOT migrated here — each is higher-risk than the
      one-design win warrants this batch):
        - `JobBoardPanel` — its scroll internals (`offersContainer.y` as a
          row-offset, `scrollOffers(delta,maxOffset)`, ▲/▼ arrows) are pinned by
          `jobBoardScroll.test.ts`; migrating would change those structures and
          break existing assertions (standing rule: don't touch existing tests).
        - `EquipmentShopScene` / `StationScene` shop — both use a windowed
          `slice` + re-render-on-scroll model fused with keyboard nav and
          buy/install interactions + toasts; a clean migration needs the same
          render-all + offset rework as InfoCenter but with much larger blast
          radius. Track separately.
        - `MainMenuScene` — has NO scrollable list (parallax stars only); the
          plan's mention of it is inaccurate, nothing to migrate.
- [x] write/extend tests for at least one migrated panel
      → `src/tests/presentation/infoCenterNewsScroll.test.ts` (renders every
      item, scroll/clamp, position survives a bookmark re-render, no-overflow
      no-scroll). Plus an `enableWheel:false` case in `scrollableList.test.ts`.
- [x] run affected tests + regression — must pass before next task
      → presentation suite 340 green; e2e regression 21/21 green (incl. the
      Info-Center news-tab rumor test); lint + `tsc --noEmit` clean.

### Task 4: Varied planet rotation (perceptible, per-planet)
**Files:**
- Modify: src/presentation/PlanetSprite.ts (widen the spin range so variety is visible;
  keep `planet.id` seeding; ensure direction is an independent, well-mixed draw;
  optional small axial-tilt variation), all three render paths
- Create: src/tests/presentation/planetSpin.test.ts

- [x] extract spin into a pure `planetSpin(planetId)` → `{ speed, direction }` with a
      clearly-visible speed range and ~50/50 direction; reuse across filter/sphere/tiling
      → `planetSpin(planetId)` in `PlanetSprite.ts` returns `{speed, direction}`:
      speed in `1/60000…1/12000` longitude/ms (one rotation per ~12–60 s, a 5×
      spread vs the old 2×) seeded `spin_<id>`, direction an independent ~50/50
      draw. All three map-backed paths in `buildEquirectSphere` (GLSL filter,
      sphere mesh, tiling disc) consume it; the tiling disc scales by
      `TILING_SCROLL_SCALE` (px/ms vs longitude/ms). The `surf_` RNG that only
      fed spin in this method is gone.
- [x] write tests: distinct ids → distinct speed/direction; speeds in the visible band;
      a sample of ids is direction-mixed (not all one sign)
      → `src/tests/presentation/planetSpin.test.ts`: deterministic per id,
      distinct ids differ, speeds in `[1/60000, 1/12000]` (period 12–60 s),
      direction ±1 well-mixed over 300 ids (both signs >30%), wide spread
      (max/min > 3×).
- [x] run affected tests — must pass before next task
      → planetSpin + planetSpriteVelocity + planetSpriteMask = 12 green;
      lint 0 errors; `tsc --noEmit` clean.

### Task 5: Verify acceptance criteria
- [x] verify Overview: journal (and the other panels) scroll to every item; planets
      visibly spin at varied speeds and directions
      → journal scroll confirmed by regression #14 ("quest journal with >2 active
      quests scrolls to reveal them all — no dead +N ещё"); InfoCenter news-tab
      migration confirmed by regression #21 (TRADE_OPPORTUNITY rumor renders);
      planet spin variety covered by `planetSpin.test.ts` (distinct ids → distinct
      speed/direction, speeds in the visible 12–60 s band, direction-mixed sample)
      and was screenshot-verified in Task 4.
- [x] run full unit suite — all green → 208 files / 1766 tests passed
- [x] run `npm run test:e2e:regression` → 21/21 passed (~1.6m, NO_PROXY for webServer)
- [x] run `npm run lint` — clean → 0 errors (29 pre-existing `any` warnings in
      unrelated test files, untouched by this plan)
- [x] confirm no existing test assertions changed → only `playtest-regression.spec.ts`
      modified, purely additive (0 deleted lines); all other test files are new

## Technical Details
- **ScrollableList:** content container translated by a clamped `scrollOffset`; a
  Graphics mask added to the clip; `attachWheelScroll` maps wheel delta → `scrollBy`.
  Item-renderer + item-height keeps it list-type-agnostic (quests, gear, jobs, saves).
- **Planet spin range:** target ~one rotation per 12–60 s with a wide spread so two
  planets read as different; keep it slow enough to stay tasteful. If similar per-system
  `planet.id`s cluster under the current hash, mix the seed (e.g. `hashStr`) so adjacent
  planets diverge.

## Post-Completion
**Manual verification:** open the quest journal with 3+ active quests and scroll to all
of them; fly through a couple of systems and confirm planets spin at visibly different
speeds and directions (some retrograde).
