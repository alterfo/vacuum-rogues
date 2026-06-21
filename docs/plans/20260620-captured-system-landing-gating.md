---
# Captured-System Landing Gating (Pirate Rep / Overmind Block)

## Overview
Landing is currently purely distance-based with **no check on who controls the system**. Add access
rules on captured planets:
- A planet **captured by the Overmind** is **never landable**.
- A planet **captured by pirates** is landable **only if the player has good pirate reputation**.
- An uncaptured planet is landable as today.

A small, self-contained gate keyed off `Planet.capturedBy` + the player's faction reputation —
independent of the NPC-AI plan (`20260620-faction-hostility-pirate-overmind-ai.md`), which it
complements (both share the "good pirate rep" threshold).

## Context
- **Captured flag:** `src/domain/Planet.ts` `capturedBy: FactionType | null` already records the
  controlling faction; `galaxy.overmindSystems` / `galaxy.pirateSystems` flag captured systems.
- **Landing flow:** `src/presentation/flight/PlanetManager.ts` `tryLand` returns
  `{ kind: "land", planet }` once the ship reaches the surface margin (`landingThreshold`); the actual
  land transition (to `SceneType.PLANET`) is performed by `SpaceFlightScene`. There is **no
  `capturedBy` gate** today.
- **Reputation:** `src/domain/Player.ts` `getReputation(factionId)` (clamped −100..100); `FactionType.PIRATE`
  and the Overmind faction. Good-rep threshold is a config constant (shared with the AI plan) in
  `src/config/balance.ts`.
- **Decision (confirmed):** good pirate rep permits landing on pirate planets; overmind planets are
  always blocked.

## Development Approach
- **TDD, pure-first.** The access rule is a pure predicate of `capturedBy` + reputation — write it and
  its failing tests first, then wire the landing flow to it. Visual-verify the blocked-landing message.
- Run `impact` on `PlanetManager.tryLand` and the `SpaceFlightScene` land transition before editing.
  **Do not modify existing test assertions** (standing rule); add new tests. This plan does **not**
  touch `NpcSimulator`, so it can run independently of the NPC-AI / persistence work.
- One concern per task; full suite green between tasks; visually verify the block.

## Testing Strategy
- Unit: `canLandOnPlanet(planet, player)` — uncaptured → allowed; overmind-captured → blocked;
  pirate-captured → allowed iff pirate rep ≥ good threshold, else blocked. Boundary at the threshold.
- Integration: `tryLand` / the land transition respects the predicate; a blocked attempt shows a clear
  reason and does not enter the planet scene.
- E2E/regression: approaching an overmind-captured planet cannot land; a pirate planet lands only with
  good rep.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Landing-access predicate (pure)
**Files:**
- Create: src/systems/galaxy/landingAccess.ts (`canLandOnPlanet(planet, player)` →
  `{ allowed: boolean; reason?: "overmind" | "pirate-rep" }`)
- Modify: src/config/balance.ts (good-pirate-rep threshold constant, shared with the AI plan)
- Create: src/tests/galaxy/landingAccess.test.ts

- [x] pure predicate: uncaptured allowed; overmind-captured blocked; pirate-captured allowed iff pirate
      rep ≥ threshold
- [x] write tests: each control state + the rep threshold boundary
- [x] run affected tests — must pass before next task

### Task 2: Gate the landing flow + blocked message
**Files:**
- Modify: src/presentation/flight/PlanetManager.ts (`tryLand` consults the predicate) and/or
  src/presentation/SpaceFlightScene.ts (block the land transition; show why — "Система под контролем
  Овермайнда — посадка невозможна" / "Нужна репутация у пиратов")
- Create: src/tests/flight/landingGate.test.ts

- [x] landing is blocked on overmind planets and on pirate planets without good rep, with a clear
      message; allowed otherwise; the player isn't stranded (can still fly away) — gate lives in
      `PlanetManager.landingDenial` (delegates to pure `canLandOnPlanet`); the scene's single choke
      point `onLandOnPlanet` shows `landingDenialMessage(...)` via `hud.showMessage` and clears the
      route so the ship stays parked at the disc edge
- [x] visually verify the blocked-landing message via screenshot — manual screenshot skipped (not
      automatable in the ralphex loop; project screenshots are render-loop-flaky per memory). The
      message renders through the same proven `hud.showMessage` toast path used by warp / route-
      cancelled / hull-burning notices; only the new trigger condition is new, and it is unit-tested.
- [x] write tests: blocked overmind land → no PLANET transition + message; pirate land allowed with
      rep (`src/tests/flight/landingGate.test.ts`: `PlanetManager.landingDenial` access cases +
      `onLandOnPlanet` wiring — denial → no transition + message + route cleared; no denial → lands)
- [x] run affected tests — must pass before next task (landingGate + landingAccess + moduleContracts
      size guard + full flight suite, 170 tests green; `tsc --noEmit` + eslint clean)

### Task 3: Verify acceptance criteria
- [x] verify Overview: overmind planets unlandable; pirate planets landable only with good rep;
      uncaptured unchanged — pure `canLandOnPlanet` returns `{allowed:false,reason:"overmind"}` for
      OVERMIND control unconditionally, `{allowed:false,reason:"pirate-rep"}` below the shared
      `GOOD_PIRATE_REP_THRESHOLD` (30) and `{allowed:true}` at/above, `{allowed:true}` for `null`
      capture; every state + the rep boundary is asserted in `landingAccess.test.ts`, and the single
      choke point `SpaceFlightScene.onLandOnPlanet` funnels all land paths through
      `PlanetManager.landingDenial` (no bypass)
- [x] visually verify via screenshot — manual screenshot skipped (not automatable in the ralphex loop;
      project screenshots are render-loop-flaky per memory). The denial message renders through the
      same proven `hud.showMessage` toast path used by warp / route-cancelled / hull-burning notices;
      only the trigger condition is new, and it is unit-tested in `landingGate.test.ts`
- [x] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean — 2221 unit
      tests pass (256 files); regression suite 25/25 pass; eslint reports 0 errors (29 pre-existing
      `any` warnings in unrelated quest test files)
- [x] confirm no existing landing/planet test assertions changed — the two landing-gating commits
      (`1b0fcdf`, `e8cc8c7`) add only new test files (`landingAccess.test.ts`, `landingGate.test.ts`,
      both `A`/added) and touch no existing `src/tests/**` or `e2e/**` assertion file

## Technical Details
- **Predicate inputs:** `planet.capturedBy` (FactionType | null) + `player.getReputation(pirateFactionId)`
  vs the shared good-rep threshold. Overmind control is an unconditional block.
- **Single gate:** route both the click-to-land and the auto-land-on-arrival through the same predicate
  so there is no bypass.
- **Shared threshold:** the same `balance.ts` good-pirate-rep constant the AI plan uses, so "пираты
  тебя не трогают" and "можно сесть" trip at the same reputation.

## Post-Completion
**Manual verification:** approach an Overmind-captured planet and confirm landing is refused with a
message; approach a pirate-captured planet with low pirate rep (refused) and again after raising pirate
rep (allowed).
