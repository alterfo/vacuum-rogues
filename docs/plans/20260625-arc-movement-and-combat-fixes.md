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

- [ ] Diagnose why the hit-area is lost (collapsing `worldR`, or `eventMode`/
      `hitArea` clobbered when combat starts / cursors switch) and fix it so the
      clickable radius never shrinks below a sane minimum and `eventMode="static"`
      survives combat + `setCursors`.
- [ ] write a **real-pointer** E2E asserting an NPC stays hit-testable across zoom
      and once a fight is engaged (the headless unit can't see hit geometry).
- [ ] run tests — green.

### Task 3: Space the hangar «Установить» / «Продать» buttons
**Files:**
- Modify: `src/presentation/EquipmentShopScene.ts` (the hangar panel from the combat-hangar plan)

- [ ] Increase the gap between the «Установить» (install) and «Продать» (sell)
      actions so they're not mis-tapped; align with the panel's existing button
      spacing.
- [ ] write/extend a layout test asserting the two buttons don't overlap and have a
      minimum gap; **screenshot-verify**.
- [ ] run tests — green.

### Task 4: Verify acceptance criteria (incl. "combat reads cleanly")
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only ShipPhysics +
      NpcShipSprite/manager + EquipmentShopScene (+ tests) affected.
- [ ] full unit suite green; `npm run test:playtest` green; lint clean; build ok.
- [ ] **Manual/visual:** ships fly straight + arc (no pivot), NPCs stay clickable,
      and combat reads cleanly (the reported "strangeness" is gone or specifics are
      filed as ➕ follow-ups).

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/flight/playtest-traps.md` / `flight/CLAUDE.md`

- [ ] Document the momentum/arc movement model (no in-place rotation; min turn
      radius), the NPC hit-area invariant, and the hangar button spacing.

## Technical Details
- Arc motion is `position += heading*speed*dt` with `heading` turned at a bounded
  rate while `speed > 0`; min turn radius = `speed / rotationSpeed`. Tune
  `rotationSpeed`/`maxSpeed` so arcs feel right (≈19px today). Pure-physics change;
  no data/schema/save impact.

## Post-Completion
**Manual verification:** fly toward a target behind the ship → it arcs around
instead of pivoting; click NPC ships before/during a fight → always responsive;
open the hangar → «Установить»/«Продать» are clearly separated.
