---
# Flight & Shop Polish: Route Trajectory, System-Edge Ring, Shop "Есть" Label

## Overview
Three independent polish fixes:
1. **Planned route ≠ flown trajectory.** The dashed course overlay (`RouteRenderer`) sometimes
   diverges from the path the ship actually flies (`ShipPhysics.setPath`, which bows around the star).
   Drive both from a single path so the drawn route matches the flight exactly.
2. **System-edge ring is distracting.** `OrbitRenderer` strokes a boundary ring at the system edge
   ("рамочка") — the request is to not highlight the edge. Remove/hide it.
3. **Confusing shop "Есть" label.** In the equipment shop, owned-but-uninstalled gear (e.g.
   "Топливный бак") shows a dead `"Есть"` label with no action. Make it clear/actionable.

## Context
- **Route render vs physics:** `src/presentation/SpaceFlightScene.ts` — `routePath` is "the full
  curved path… the ship flows through it via `ShipPhysics.setPath`" (L113–115); `RouteRenderer`
  (`src/presentation/flight/RouteRenderer.ts`) "renders exactly what it is told" (`drawRoute(path)`).
  The scene must hand the renderer the **same** polyline the physics consumes; divergence comes from
  building the drawn line separately from the flown path (or not redrawing on re-plan).
- **Boundary ring:** `src/presentation/flight/OrbitRenderer.ts` `drawBoundaryRing` (~L117–125):
  `ring.circle(centerX, centerY, SYSTEM_GEOMETRY.boundaryRadius)` stroked `0x2266aa, alpha 0.35`.
  (Confirm there is no second "edge vignette" the user means — `FlightModule` L55 mentions one.)
- **Shop label:** `src/presentation/EquipmentShopScene.ts` (~L673–710): `btnLabel = isInstalled ?
  "Установлен" : alreadyOwned ? "Есть" : canAfford ? "[Купить]" : "Мало₡"`; the `"Есть"` branch sets
  `eventMode = "none"` (dead). The ТРЮМ strip + `installOwnedGear`/`ownedUninstalledGear`
  (`GearBridge`) already exist. **Overlap:** the equipment overhaul plan
  (`20260619-equipment-install-and-micromodule-overhaul.md`) also touches this scene's install flow —
  keep this fix minimal (label/action only) and avoid colliding with that plan if both run.
- **Decision:** keep all three minimal/surgical.

## Development Approach
- **Route fix is regression-first/unit-testable** (a pure "the drawn polyline equals the flown path"
  assertion). The ring removal and label change are **visual/UX** — verify by screenshot; add a small
  assertion only where a pure seam exists (e.g. the label-selection function).
- Run `impact` on `RouteRenderer`/`drawRoute` and the `OrbitRenderer` boundary method before editing.
- **Do not modify existing test assertions** (standing rule); add new tests. Route dark-panel text
  through `scaledText` if touching shop text.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: the route handed to `RouteRenderer.drawRoute` is the same path passed to
  `ShipPhysics.setPath` (single-source); a pure `shopActionLabel(state)` returns an actionable label
  for owned-but-uninstalled gear.
- Visual/E2E: planned dashed line overlays the actual flight path; the system-edge ring is gone; the
  shop row for an owned item shows a clear, actionable control.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Single-source route — drawn line matches flown path
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (hand `RouteRenderer` the exact `routePath` consumed by
  `ShipPhysics.setPath`; redraw on re-plan / as the ship consumes it)
- Create: src/tests/flight/routeMatchesPath.test.ts

- [x] the polyline drawn by `RouteRenderer.drawRoute` is the same path passed to `ShipPhysics.setPath`
      (including the star-avoidance bow), and is re-derived from one source on every (re)plan
- [x] write tests: drawn route == physics path for a star-crossing route and a re-planned route
- [x] run affected tests — must pass before next task

### Task 2: Remove the system-edge ring
**Files:**
- Modify: src/presentation/flight/OrbitRenderer.ts (remove/hide `drawBoundaryRing`; confirm no other
  edge frame/vignette is what the user meant)

- [ ] the system-boundary ring is no longer drawn (orbit circles and warp-in behaviour unchanged)
- [ ] visually verify via screenshot that the edge is no longer highlighted
- [ ] add/keep a test that no boundary-ring graphic is created (if a seam exists)
- [ ] run affected tests — must pass before next task

### Task 3: Clear, actionable shop label for owned gear
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts (`"Есть"` → an actionable/clear control for
  owned-but-uninstalled gear, e.g. route to install via `installOwnedGear`, or a clear "В трюме"
  state that points at the ТРЮМ strip)
- Create: src/tests/equipment/shopOwnedLabel.test.ts

- [ ] owned-but-uninstalled gear no longer shows a dead "Есть"; the row clearly conveys it is owned
      and offers the next action (install / go to ТРЮМ)
- [ ] keep the change minimal to avoid colliding with the equipment-overhaul plan's install flow
- [ ] write tests for the pure label/action selection across states (buy / owned / installed / no-funds)
- [ ] run affected tests — must pass before next task

### Task 4: Verify acceptance criteria
- [ ] verify Overview: drawn route matches the flight path; no system-edge ring; clear shop label
- [ ] visually verify all three via screenshot
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing test assertions changed

## Technical Details
- **Single-source route:** the scene owns one `routePath`; both `ShipPhysics.setPath` and
  `RouteRenderer.drawRoute` consume it. No second geometry is computed for the overlay.
- **Ring removal:** simplest is to stop calling/creating the boundary-ring `Graphics`; warp-in/out
  still keys off `SYSTEM_GEOMETRY.boundaryRadius` (geometry constant unchanged, only the decoration
  is removed).
- **Shop label:** prefer reusing `installOwnedGear`/`ownedUninstalledGear` rather than inventing a new
  install path; if the equipment-overhaul plan lands first, this collapses to a label-only change.

## Post-Completion
**Manual verification:** plan a route that crosses the star and confirm the dashed line matches the
ship's actual path; confirm the system edge is no longer ringed; in the equipment shop, confirm an
owned item shows a clear, actionable control instead of "Есть".
