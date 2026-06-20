---
# NPC Ship Persistence & System Consistency

## Overview
NPC ships in a star system are not consistent across scene transitions. Two real bugs:
1. **Positions jump on every re-entry.** `NpcShipManager` places each ship with `Math.random()`
   for angle and radius on every `initialize()`, and `NpcShip` carries `currentSystemId` but **no
   persistent world position** — so leaving and returning to a system re-scatters the ships.
2. **Composition changes on a star-map round-trip.** Going to the galaxy map, picking a jump target,
   and returning *without actually jumping* changes which ships are present (e.g. traders become
   Dominators) — the simulation repopulates/wanders when it shouldn't.

The fix (per the request: positions should be "like ABS — полностью отслеживаемо и
консистентно/персистентно… посчитаны"): make NPC presence and position **fully tracked, persistent,
and deterministic** — each ship has a saved world position changed only by tracked simulation ticks,
and a mere star-map visit (no jump, no day advance) never alters a system's ships.

## Context
- **Ship source:** `npcsPresentInSystem(galaxy, systemId)` (`src/systems/npc/NpcSimulator.ts` L1675)
  filters `galaxy.npcShips` by `currentSystemId` + state (`!= TRAVELING/DEAD`). Composition is
  data-driven off `galaxy.npcShips` (persistent), so the swap comes from re-simulation, not the read.
- **Position bug:** `src/presentation/flight/NpcShipManager.ts` — `initialize()` (L173) iterates
  `npcsPresentInSystem`; the spawn placement (~L437–461) uses `Math.random()` for `angle`/`radius`,
  so positions are fresh every entry. `NpcShipSprite` takes `(npc, spawnX, spawnY, bounds)`.
- **Domain + persistence:** `src/domain/NpcShip.ts` (no `worldX`/`worldY` today),
  `src/validation/schemas.ts` (`NpcShipSchema`), `src/data/MigrationPipeline.ts`. Adding a persisted
  position is a **domain + schema lockstep** change (CLAUDE.md) + a migration default for old saves.
- **Simulation tick:** `NpcSimulator` advances on the galaxy-day tick (wandering, `ensureGarrison`
  for `overmindSystems`/`pirateSystems`). The star-map open/return flow (GameEngine `transitionTo`
  STAR_MAP → SPACE_FLIGHT) must NOT advance the simulation unless an actual jump/day-advance happens.
- **Seeding:** `src/utils/seededRNG.ts` (`SeededRNG`) is used elsewhere for deterministic spawn from
  the galaxy seed — reuse it for first-time deterministic placement.
- **Decision (confirmed):** **persistent tracked positions** — saved per-ship world position, changed
  only by tracked ticks.

## Development Approach
- **TDD / regression-first.** Determinism and persistence are pure-testable: the same system entered
  twice (no tick between) yields identical ships at identical positions. Write the failing
  consistency test first, then fix.
- **Blast-radius first.** Run `impact`/`detect_changes` on `NpcShip`, `npcsPresentInSystem`,
  `NpcShipManager`, and `NpcShipSchema` before editing and report the radius (HIGH fan-in).
- **Schema lockstep + migration:** the new position field updates `schemas.ts` + `MigrationPipeline.ts`
  in the same task; old saves get a deterministic default position (seed-derived), not random.
- **Do not modify existing test assertions** (standing rule); add new tests. Visual-verify by
  screenshot (same ships in the same spots after a star-map round-trip).
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: deterministic placement — given a ship + system + seed, position is reproducible; persisted
  position round-trips through save/load; a ship with a stored position re-spawns there, not random.
- Integration: enter a system, open the star map, return without jumping → identical
  `npcsPresentInSystem` set AND identical positions; only a real jump/day-advance changes them.
- E2E/regression: take off, note the ships; open and close the galaxy map; the same ships are in the
  same positions.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any NPC/save test that reds). Keep in sync.

## Implementation Steps

### Task 1: Persistent world position on NpcShip
**Files:**
- Modify: src/domain/NpcShip.ts (`worldX`/`worldY` with explicit setter), src/validation/schemas.ts
  (`NpcShipSchema`), src/data/MigrationPipeline.ts (default for old saves)
- Create: src/tests/npc/npcShipPosition.test.ts

- [x] run `impact` on `NpcShip` + `NpcShipSchema`; report the blast radius before editing
      (NpcShip upstream: CRITICAL — 99 impacted, 30 direct callers, modules Flight/Presentation/Npc;
      change is purely additive so no caller updates needed)
- [x] add a persisted world position (mutated only via an explicit method), schema in lockstep
      (`worldX`/`worldY` on `NpcShip` + `NpcShipInit`, setter `setWorldPosition`, `NpcShipSchema`
      nullable-default-null in lockstep)
- [x] old saves migrate with a deterministic (seed-derived) default position, not random
      (MigrationPipeline v23→24 via `deterministicNpcOffset(galaxyId, npcId)` in new
      `src/systems/npc/npcPlacement.ts`)
- [x] write tests: position persists + round-trips; migration default is deterministic
      (`src/tests/npc/npcShipPosition.test.ts`)
- [x] run affected tests — must pass before next task (npcShipPosition + saveMigration + npcSimulator
      + validation + banking persistence all green; lint + tsc clean)

### Task 2: Deterministic placement, read persisted position
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (spawn at the ship's stored position; first-time
  placement via `SeededRNG` from the galaxy seed, then persist it — no `Math.random()`)
- Create: src/tests/npc/deterministicPlacement.test.ts

- [x] replace `Math.random()` placement with: use stored position if present; else seed-derive a
      stable interior position and persist it
      (`addNpcSprite` reads `npc.hasWorldPosition()`; first interior spawn uses
      `deterministicNpcOffset(galaxy.id, npc.id)` + convoy offset, then `setWorldPosition` persists it.
      Boundary entry stays seed-angled, not persisted — it re-resolves to an interior spot next entry.)
- [x] write tests: same ship/system/seed → identical position twice; stored position reused on re-entry
      (`src/tests/npc/deterministicPlacement.test.ts`: seed-derived offset persisted; identical on
      re-entry; identical across independent managers (no `Math.random`); differs by id/seed; pre-stored
      position reused verbatim)
- [x] run affected tests — must pass before next task (deterministicPlacement + npcShipManager +
      npcShipPosition + npcShipDwell green; full npc/presentation/flight suites 563 passed; lint + tsc clean)

### Task 3: No re-simulation on a star-map round-trip
**Files:**
- Modify: src/systems/GameEngine.ts (STAR_MAP ↔ SPACE_FLIGHT transition) and/or
  src/systems/npc/NpcSimulator.ts (only tick on a real jump/day-advance)
- Create: src/tests/npc/starMapRoundTrip.test.ts

- [x] opening the galaxy map and returning **without a jump** does not tick the simulation:
      `galaxy.npcShips` composition + positions for the current system are unchanged
      (verified by construction: the simulation clock is owned solely by
      `GameEngine.advanceGalaxyDay` — the only caller of `NpcSimulator.tick` — which fires only
      from `SpaceFlightScene`'s move/wait day-loops, never from a `transitionTo`. `StarMapScene`
      itself advances no day/tick. No production change needed; the discipline already held.)
- [x] a real jump/day-advance still ticks NPCs (wandering, garrisons) as before
      (`advanceGalaxyDay` unchanged: increments `gameDays` and ticks the simulator; test asserts it)
- [x] write tests: round-trip leaves the system's ship set + positions identical; a jump does tick
      (`src/tests/npc/starMapRoundTrip.test.ts`: drives real `GameEngine.transitionTo`
      STAR_MAP→SPACE_FLIGHT with a stubbed scene factory + a real generated galaxy; spies prove
      `npc.tick`/`advanceGalaxyDay` are NOT called, `gameDays` + composition + worldX/worldY frozen;
      a second test proves `advanceGalaxyDay` ticks once and advances the day)
- [x] run affected tests — must pass before next task (starMapRoundTrip + full npc/core suites +
      npcSimulator: 140 passed; lint + tsc clean)

### Task 4: Tracked movement — positions evolve only via ticks
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts (advance persisted positions deterministically on tick),
  src/presentation/flight/NpcShipManager.ts (write live positions back so they persist)
- Create/Modify: src/tests/npc/trackedMovement.test.ts

- [x] NPC positions change only through tracked simulation ticks (deterministic), and the live
      in-flight position is written back so a save captures where the ship actually is
      (`NpcSimulator.tick` now calls `advanceTrackedPositions`: each placed, present
      (non-DEAD/non-TRAVELING) ship is rotated one deterministic orbit step via new pure helpers
      `npcOrbitStep`/`advanceNpcOrbit` in `npcPlacement.ts` — radius-preserving, no main-RNG
      consumption, never invents a position for an unplaced ship. Presentation write-back added:
      `NpcShipManager.persistLivePositions()` mirrors each live sprite offset back to its domain
      ship, called on `destroy()` so a save/scene-transition captures the live layout — no scatter.)
- [x] write tests: a tick moves a ship deterministically; without a tick, position is frozen
      (`src/tests/npc/trackedMovement.test.ts`: one orbit step/tick, N-step accumulation over N
      ticks, deterministic across galaxies, frozen without a tick, unplaced ship stays null,
      traveling ship frozen; plus write-back: live position persisted + re-entry respawns it)
- [x] run affected tests — must pass before next task (trackedMovement 8 passed; npc suites +
      npcSimulator + garrisonCombat 103 passed; flight + presentation 493 passed; save/validation/
      core 51 passed; lint + tsc clean)

### Task 5: Verify acceptance criteria
- [ ] verify Overview: positions stable across re-entry; composition stable on star-map round-trip;
      changes only via tracked ticks; persists through save/load
- [ ] visually verify via screenshot (same ships, same spots after a galaxy-map round-trip)
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing NPC/save test assertions changed

## Technical Details
- **Position model:** `worldX`/`worldY` on `NpcShip`, persisted in `NpcShipSchema`. First placement is
  deterministic (per-ship `SeededRNG` keyed by galaxy seed + ship id), then stored — so it is both
  reproducible for old saves and stable thereafter.
- **Tick discipline:** the simulation is the single owner of position change (like the ABS ledger is
  the single owner of balances). Presentation reads/writes-back but never invents positions.
- **Round-trip rule:** STAR_MAP is a read-only view; returning from it without a jump is a no-op for
  the simulation clock.

## Post-Completion
**Manual verification:** take off, note the ships around you; open the galaxy map, pick a jump target,
return without jumping — the same ships are in the same places; jump for real and confirm the
simulation has advanced consistently; reload a save and confirm positions are preserved.
