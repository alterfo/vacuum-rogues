---
# Arc-Only Ship Movement + Combat Clickability + Hangar Button Spacing

## Overview
Three flight/combat/UI fixes the player reported together:

1. **No more rotate-in-place.** Ships currently **stop and pivot** to face a target
   (the engine only accelerates when "aligned" within 60° and slows when not), which
   reads as twitchy/unnatural. Ships should **always move forward** and **turn only
   by arcing** (a bounded turn rate ⇒ a minimum turn radius) — like a real craft with
   momentum; a target behind is reached by looping around, never by spinning on the
   spot.
2. **Ships become unclickable.** At some point NPC ships stop responding to clicks
   (`NpcShipSprite` resets its `hitArea` to `Circle(0,0, worldR)` — `worldR` collapses
   at some zoom/state, or the container's interactivity gets clobbered in combat).
3. **Combat reads "strange."** Largely a symptom of (1)+(2) (pivoting + lost
   clicks); verify it reads cleanly after those land.
4. **Hangar «Установить»/«Продать» are too close** — space them apart in the
   equipment-shop hangar UI (the panel the `combat-multiweapon-…-hangar` plan adds).

## Context (from discovery)
- **Movement model (`src/systems/ShipPhysics.ts`, update ~L185-245):** rotates
  `shipAngle` toward `atan2(dy,dx)` at `rotationSpeed = π/2/300` rad/ms, but only
  **accelerates when `isAligned` (|angleDiff| < π/3)** and **decelerates when not
  aligned** — so an off-axis target drops `currentSpeed` toward 0 and the ship
  pivots in place. `maxSpeed = 0.1` px/ms; min turn radius if always moving ≈
  `maxSpeed/rotationSpeed ≈ 19px`. Final-leg deceleration (stop at destination)
  must be preserved; intermediate waypoints fly through at speed.
- **NPC clickability (`src/presentation/NpcShipSprite.ts`):** `container.eventMode
  = "static"`, `hitArea = new Circle(0,0,40)` (L188) then **reset to `Circle(0,0,
  worldR)` (L214)**; `setCursors` (NpcShipManager L576) toggles cursor by turn
  state. Suspect `worldR` shrinking or an `eventMode`/`hitArea` clobber during a
  fight. Per the repo rule, hit geometry needs a **real-pointer test**
  (`rootBoundary.hitTest`), not just a unit assertion (see the UiButton-hitArea
  regression precedent).
- **Hangar UI (#4):** the «Установить»/«Продать» buttons live in the new hangar
  panel added by `docs/plans/20260623-combat-multiweapon-starter-loadout-shared-
  hangar.md` (`EquipmentShopScene` / hangar panel) — adjust their layout spacing.
- **Overlap/ordering:** this edits `ShipPhysics` + combat (`NpcShipManager`/
  `SpaceFlightScene`) + `EquipmentShopScene` — the **same files as the running
  combat-hangar plan and the `smooth-auto-follow-movement` plan**. RUN THIS **after**
  both. The arc-movement fix (Task 1) is the *fundamental* momentum model; the
  auto-follow plan's lead-point/re-plot smoothing is complementary (sits on top).

## Development Approach
- **Testing approach: TDD.** The movement model is pure (`ShipPhysics.update`):
  assert no stop-and-pivot (heading only changes while moving; speed never collapses
  to pivot for an off-axis target), a bounded per-frame heading change, and a
  resulting **minimum turn radius**. Clickability uses a **real-pointer E2E**
  (`rootBoundary.hitTest`) since headless unit tests can't see hit geometry. Button
  spacing is a layout-coord assertion + screenshot.
- Run `impact` on `ShipPhysics.update` / `NpcShipSprite` hit-area / the hangar panel
  before editing. Preserve final-leg deceleration, waypoint fly-through, sun
  avoidance, and the combat pursuit/engage lifecycle. No domain/schema/save change.

## Testing Strategy
- **Unit:** `ShipPhysics.update` — for a target directly behind, the ship keeps a
  forward speed > 0 and turns by ≤ `rotationSpeed*dt`/frame (arc), reaching the
  target without `currentSpeed` hitting 0 mid-course; min turn radius is bounded;
  final-leg still decelerates to a stop at the destination.
- **E2E (real pointer):** an NPC ship stays clickable across zoom + during combat
  (`rootBoundary.hitTest` over the sprite returns the container); regression for the
  "becomes unclickable" report.
- **Real-engine playtest:** combat engages/pursues/ends without errors after the
  movement change.

## Implementation Steps

### Task 1: Momentum / arc-only movement in ShipPhysics
**Files:**
- Modify: `src/systems/ShipPhysics.ts`
- Modify: `src/tests/**` ShipPhysics movement tests

- [x] Replace the alignment-gated speed logic so the ship **always advances forward**
      along `shipAngle` at a maintained cruise speed (accelerate to `maxSpeed`; do
      **not** drop speed because the target is off-axis), and turn `shipAngle` toward
      the target at `rotationSpeed` **only while moving** ⇒ the path arcs (minimum
      turn radius). A target behind is reached by arcing around, never by pivoting.
- [x] Preserve final-leg deceleration (stop AT the destination), intermediate
      waypoint fly-through, and sun-avoidance pathing.
- [x] write tests: off-axis/behind target ⇒ speed stays > 0 and heading changes are
      turn-rate-bounded (arc); min turn radius bounded; final approach still stops;
      no regression on straight-line travel timing.
- [x] run tests — green.

### Task 2: Keep NPC ships clickable (hit-area fix)
**Files:**
- Modify: `src/presentation/NpcShipSprite.ts` (and/or `NpcShipManager`)
- Create: `e2e/` real-pointer test (or extend `playtest-regression.spec.ts`)

- [x] Diagnose why the hit-area is lost (collapsing `worldR`, or `eventMode`/
      `hitArea` clobbered when combat starts / cursors switch) and fix it so the
      clickable radius never shrinks below a sane minimum and `eventMode="static"`
      survives combat + `setCursors`. (Root causes: a non-finite/≤0 `cameraZoom`
      made `Math.max(28, 40/NaN)` → `NaN`, a hit-circle that never contains even
      its own centre; and `updateHitArea`/`restoreInteractivity` never re-asserted
      `eventMode="static"` on a live ship. Fix: a single `assertClickable()`
      invariant — re-asserts `eventMode="static"` + a finite radius ≥ 28, and the
      finite-zoom guard remembers the last good zoom so a transient bad transform
      can't collapse the circle.)
- [x] write a **real-pointer** E2E asserting an NPC stays hit-testable across zoom
      and once a fight is engaged (`rootBoundary.hitTest` over the aggressor at
      three zooms during an engaged fight returns the NPC container).
- [x] run tests — green. (8 unit + targeted combat/presentation suites + the new
      E2E; 2 of the new unit tests proven red-on-legacy then green.)

### Task 3: Space the hangar «Установить» / «Продать» buttons
**Files:**
- Modify: `src/presentation/EquipmentShopScene.ts` (the hangar panel from the combat-hangar plan)

- [x] Increase the gap between the «Установить» (install) and «Продать» (sell)
      actions so they're not mis-tapped; align with the panel's existing button
      spacing. (Fixed in the shared `HangarPanel.renderWarehouseAndCargo` — the
      single fitting surface both StationScene and the EquipmentShop АНГАР tab
      mount, so the fix lands at both entry points. The two actions sat 13 px
      apart in the same right-hand column — inside the ~14 px text height, so
      their hit boxes overlapped. Grew each warehouse row 30→40 px, moved
      «Установить» to `y+12` and «Продать» to `y+32` (a 20 px centre gap, clear of
      the text height), and bumped the row step 38→48 + the clip guard 34→42.)
- [x] write/extend a layout test asserting the two buttons don't overlap and have a
      minimum gap; **screenshot-verify**. (New `HangarPanel.test.ts` case asserts
      the centre gap exceeds the button height — `gap > height` — and a clear
      minimum of 16 px; the old 13 px gap would fail it. Screenshot-verify is a
      manual visual step — this app's per-frame render loop makes headless
      screenshots unreliable [memory: browser-debugging-spacerangers], so the
      layout test is the automatable substitute.)
- [x] run tests — green. (10/10 `HangarPanel.test.ts`; lint clean.)

### Task 4: Verify acceptance criteria (incl. "combat reads cleanly")
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — confirmed the plan's
      three commits (74bf32d arc, 356dbbc clickable, b67db86 hangar) touch only
      `ShipPhysics.ts` + `NpcShipSprite.ts` + the shared `ui/HangarPanel.ts` (mounted
      by both StationScene and the EquipmentShop АНГАР tab) + their tests + the e2e
      regression spec — exactly the expected scope. (The raw gitnexus compare-to-master
      is dominated by this long-lived branch's unrelated divergence, so the targeted
      three-commit diff is the meaningful lens.)
- [x] full unit suite green (323 files / 2721 tests pass); `npm run test:playtest`
      green (15/15); lint clean (0 errors — only pre-existing `any` warnings in test
      files); `npm run build` ok (tsc + vite, built in ~10.5 s).
- [x] **Manual/visual** (skipped — not automatable from here; this app's per-frame
      render loop makes headless screenshots unreliable [memory:
      browser-debugging-spacerangers]). Substituted by the automatable proxies already
      green: the ShipPhysics arc unit tests (no pivot / bounded turn radius / final
      stop), the real-pointer NPC-clickable E2E across zoom + engaged combat, and the
      playtest suite asserting combat engages/pursues/ends with zero logged errors.

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/flight/playtest-traps.md` / `flight/CLAUDE.md`

- [x] Document the momentum/arc movement model (no in-place rotation; min turn
      radius), the NPC hit-area invariant, and the hangar button spacing.
      (Movement model + NPC `assertClickable` invariant added to
      `flight/playtest-traps.md` as two new sections, with discovery pointers in
      `flight/CLAUDE.md`; the warehouse-row button-spacing convention added to the
      presentation-layer `src/presentation/CLAUDE.md` where `HangarPanel` is
      documented — the hangar is a shared UI component, not a flight module.)

## Technical Details
- Arc motion is `position += heading*speed*dt` with `heading` turned at a bounded
  rate while `speed > 0`; min turn radius = `speed / rotationSpeed`. Tune
  `rotationSpeed`/`maxSpeed` so arcs feel right (≈19px today). Pure-physics change;
  no data/schema/save impact.

## Post-Completion
**Manual verification:** fly toward a target behind the ship → it arcs around
instead of pivoting; click NPC ships before/during a fight → always responsive;
open the hangar → «Установить»/«Продать» are clearly separated.
