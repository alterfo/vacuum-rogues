---
# Galaxy Map: Battle Markers, Charted-System Names & Readable Modal

## Overview
Three galaxy-map (`StarMapScene`) fixes the player hit while flying:
1. **Charted systems still show "?" with no name.** Buying a star chart sets `explored = true`
   (the dot + warp lanes render), but the name is gated by `getSystemVisibility()`, which only
   knows *visited* systems — so a charted-but-unvisited system renders as "?". A purchased chart
   should reveal the system **name**.
2. **No "battle in progress" indication.** Systems are coloured by *ownership* (Overmind red,
   pirate orange) but there is no marker for a system where a fight is actually happening. Add a
   two-tone **half-red / half-green** marker for systems that currently hold *both* hostile
   (pirate/Overmind) and friendly/Ranger ships (a live fight, per NpcSimulator garrisons +
   liberation campaigns).
3. **Info modal too transparent.** The side info panel background is `alpha: 0.8`
   (`StarMapScene.ts` ~L770) and is hard to read over the star field — raise its opacity.

## Context
- **Map rendering:** `src/presentation/StarMapScene.ts` — draws only `explored` systems
  (`.filter((s) => s.explored)`); the "?" branch fires on `visibility === "unknown"`
  (~L583); system colours by ownership (~L518–543); side info panel bg `alpha: 0.8` (~L770).
- **Visibility logic:** `src/utils/starMapUtils.ts` — `getSystemVisibility(id, visited, all)`
  returns `"visited" | "neighbor" | "unknown"` from the *visited* set only (no notion of
  "charted via purchase").
- **Chart purchase:** `src/domain/Galaxy.ts` — `revealSystemsWithinHops(systemId, hops)` sets
  `explored = true` on systems within N jumps. `StarSystem.explored` is the charted flag.
- **Live NPC ships / battles:** `src/systems/npc/NpcSimulator.ts` — owns `garrisonIds`,
  `liberationCampaigns`, `captureCampaigns` (all transient/not persisted); `galaxy.overmindSystems`
  / `galaxy.pirateSystems` hold hostile-owned system ids. The set of live NPC ships (each with
  `systemId`, `hostile`, faction) is the source for "both sides present".
- **Decision (confirmed):** battle marker = **live fight present** (both hostile and
  friendly/Ranger ships in the system), not a static contested-frontier marker.

## Development Approach
- **Regression-first / TDD** for the two logic changes (name reveal, battle detection): write a
  failing unit test first, then make it green. Pure helpers, no PixiJS, so they unit-test cleanly.
- **Visual changes verified by screenshot** (modal opacity, two-tone marker) per the project's
  bug-fixing process — green text tests are not sufficient evidence for a rendering change.
- **Do not modify existing test assertions** (standing rule); add new tests only. If a change reds
  an existing test, STOP and re-diagnose.
- One concern per task; full suite green between tasks. Run `impact` on `getSystemVisibility` and
  any NpcSimulator method touched before editing.

## Testing Strategy
- Unit: `getSystemVisibility` (or its replacement) returns a "named/charted" tier for an explored
  system; a pure `systemsWithActiveBattle(ships)` helper returns exactly the systems holding both a
  hostile and a friendly ship; truly-uncharted systems still resolve to "?".
- Visual/E2E: open the star map after a chart purchase — charted systems show names; a system with
  both sides present shows the half-red/half-green marker; the info panel is legibly opaque.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Charted (explored) systems reveal their name
**Files:**
- Modify: src/utils/starMapUtils.ts (visibility: explored ⇒ at least "charted"/named)
- Modify: src/presentation/StarMapScene.ts (only render "?" for genuinely uncharted systems)
- Create: src/tests/starMap/chartedNames.test.ts

- [x] make an `explored` system resolve to a named tier (not "unknown") so its name renders;
      reserve the "?" placeholder for systems that are drawn but not yet charted
- [x] StarMapScene name-label branch uses the charted/explored state, not visited-only visibility
- [x] write unit tests: explored system → named; unvisited+unexplored → "?"; visited unchanged
- [x] run affected tests — must pass before next task

### Task 2: Pure battle-detection helper
**Files:**
- Create: src/utils/battleSystems.ts (`systemsWithActiveBattle(ships)`)
- Create: src/tests/starMap/battleSystems.test.ts

- [ ] pure helper: given live NPC ships (`{systemId, hostile, faction}`), return the set of system
      ids that hold **both** a hostile (pirate/Overmind) and a friendly/Ranger ship
- [ ] write unit tests: both sides present → battle; only hostiles → none; only friendlies → none;
      empty → none
- [ ] run affected tests — must pass before next task

### Task 3: Expose live battle systems from the simulation
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts (public `battleSystemIds()` reading live ships via the helper)
- Create/Modify: src/tests/npc/battleSystemIds.test.ts

- [ ] add a public query that feeds the live NPC ship list to `systemsWithActiveBattle` and returns
      the battle set (transient — no persistence)
- [ ] run `impact` on the touched NpcSimulator surface before editing; warn if HIGH/CRITICAL
- [ ] write tests for the query against a seeded simulation state
- [ ] run affected tests — must pass before next task

### Task 4: Two-tone battle marker + readable info modal
**Files:**
- Modify: src/presentation/StarMapScene.ts (half-red/half-green marker for battle systems; raise
  info-panel bg alpha)

- [ ] render battle systems with a half-red/half-green circle (two arcs / two half-fills), layered
      above the ownership colour
- [ ] raise the side info-panel background alpha (~0.8 → ~0.95) so text is legible over the map
- [ ] visually verify via screenshot: charted names show; battle marker shows where both sides are
      present; modal is opaque/readable
- [ ] run affected tests — must pass before next task

### Task 5: Verify acceptance criteria
- [ ] verify all three Overview items: charted systems named, battle marker on live fights, modal readable
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing test assertions changed

## Technical Details
- "Charted" vs "visited": a chart purchase reveals the **name** (and dot/lanes); full system detail
  (planets, faction depth) can still require a visit. The "?" placeholder is reserved for systems
  the player knows exist (a neighbour of a charted system) but has not charted.
- Battle = intersection of presence: `hostile` ships AND `!hostile` faction/Ranger ships sharing a
  `systemId`. Marker is purely a render of that transient set; no save changes.

## Post-Completion
**Manual verification:** buy a chart and confirm names appear; fly near a Ranger liberation
campaign and confirm the contested system shows the half-red/half-green marker; open a system's
info panel and confirm it reads cleanly over the star field.
