---
# NPC Purposeful Behavior (Regression-First)

## Overview
NPC ships currently wander aimlessly — they fly into a system, drift a bit,
turn around, and leave, ignoring their role. Make in-system NPC movement
**purposeful and role-driven**: traders fly to a planet/station, loiter
("trade"), then depart; pirates hunt or stalk traders/lanes; patrols circuit
stations/planets. The ship's path should read as "going somewhere to do
something," not random ping-pong.

## Context
- Root cause: `NpcShipSprite.pickNewTarget()` (`src/presentation/NpcShipSprite.ts:238-251`) picks a **random angle + radius** in a ring band around the star. There IS an `anchorX/anchorY` "loiter near a planet" branch, but most ships are never anchored, so they wander. Role (`NpcRole.TRADER/PIRATE/...`) does not influence movement at all.
- `NpcSimulator` (`src/systems/npc/NpcSimulator.ts`) already models roles + states (`NpcState.PATROLLING/TRAVELING/...`, `destinationSystemId`, trader `cargo`, pirate raids) for the OFF-screen day simulation — but the on-screen `NpcShipSprite` movement is disconnected from it.
- `NpcShipManager` (`src/presentation/flight/NpcShipManager.ts`) owns the sprites and already reaches planet positions via its deps (it calls `sprite.updateAnchorPosition(anchorPlanet.screenX, …)` at ~line 149). Modules never import each other — destinations (planet/station screen positions) come through `NpcShipManagerDeps` from the scene (extend the deps bundle if station/planet lists aren't fully exposed).
- Movement is turn-based: `NpcShipManager.update` advances sprites by `deltaTime * timeScale` only while the turn runs.
- Existing tests: `src/tests/presentation/npcShipManager.test.ts`, `npcShipClickable.test.ts`, `src/tests/.../npcSimulator.test.ts`. Spawn state is `PATROLLING` (playtest2 fix — don't regress the no-day-1-mass-exodus behaviour).
- Visual verification via letsplay (`e2e/letsplay-discovery.spec.ts`, project `letsplay`); env `NO_PROXY=localhost,127.0.0.1`.

## Development Approach
- Regression-first; destination-selection logic is a pure, tested helper (deterministic per ship id + role), not inline random.
- Keep flight logic in `src/presentation/flight/`; no cross-module imports — destinations injected via deps.
- Don't regress the playtest2 NPC fixes (PATROLLING spawn, hover cursor, clickability, zoom hit-areas).

## Implementation Steps

### Task 1: Role-driven destination selection (replace random wander)
**Files:**
- Create: `src/presentation/flight/npcBehavior.ts` (pure `pickNpcDestination(role, shipId, ctx)` → a target point/intent) + test
- Modify: `src/presentation/NpcShipSprite.ts`, `src/presentation/flight/NpcShipManager.ts` (inject planet/station positions via deps)

- [x] Write the RED test: `pickNpcDestination` returns a PLANET/STATION-anchored target for TRADER (and a "visit then leave" intent), a hunt/stalk target for PIRATE (toward a trader or a lane point), a station-circuit target for PATROL; deterministic per ship id; never a pure-random ring point. Confirm it FAILS (helper absent / current code is random)
- [x] Feed the sprite the available planet/station screen positions (via `NpcShipManager` deps from the scene) and replace `pickNewTarget`'s random branch with role-driven destination selection; keep the loiter-near-anchor behaviour for the "arrived, doing the thing" phase
- [x] Unit test the sprite/manager wiring (a trader sprite targets a planet position; a patrol cycles stations)
- [x] Run lint + unit + regression — green

### Task 2: Purposeful arrive → act → depart lifecycle
**Files:**
- Modify: `src/presentation/NpcShipSprite.ts`, `src/presentation/flight/NpcShipManager.ts`, optionally `src/systems/npc/NpcSimulator.ts`
- Modify: matching tests

- [x] Write the RED test: a visiting NPC flies to its destination, loiters for a bounded dwell, then heads to the system edge to leave (or picks a next destination) — not an immediate U-turn. Confirm it FAILS
- [x] Implement the arrive→dwell→depart (or →next-destination) state in the sprite, tied to the ship's `NpcState`/role so the off-screen sim and on-screen movement agree (a TRAVELING ship heads for the edge; a visiting trader calls at a planet)
- [x] Re-run letsplay; capture a few turns and confirm NPCs move toward planets/stations and leave deliberately, not ping-ponging [x] manual test (skipped - not automatable)
- [x] Run lint + unit + regression — green

### Task 3: Verify acceptance criteria
**Files:** none

- [x] `npm run lint` 0 errors; `npm test -- --run` all pass
- [x] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green, < 60 s
- [x] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — all steps ok, 0 JS errors
- [x] Observe NPC movement over several turns in the regenerated screenshots: ships head to planets/stations and depart with intent; pirates approach targets/lanes; none aimlessly ping-pong [x] manual test (skipped - not automatable)
- [x] Confirm playtest2 NPC behaviours intact (PATROLLING spawn, hover cursor, clickability)

## Post-Completion
**Manual verification:**
- Watch a system for a few turns: traders call at planets then leave, pirates stalk, patrols circuit — movement reads as purposeful.
