---
# Quest Return-for-Reward: Show the System + a Plot-Route Button

## Overview
On quests where the player must **return to a planet to collect the reward** (and
similar "go to planet X" objectives), the UI names the **planet** but not its
**system**, and offers **no way to plot a route there** — so the player knows
*where* on a planet but not *which system*, and has to navigate manually. Add the
**target system name** to the objective and a **«Проложить маршрут» (plot route)**
button that routes the player to the quest's target (warp toward the target system
if it's elsewhere, then approach the target planet in-system).

## Context (from discovery)
- **Quest targets are already modelled** (`src/systems/quests/QuestGenerator.ts`):
  `GeneratedQuest.targetSystemId: string` + `targetPlanetId: string | null`.
  Delivery completion keys on `quest.targetSystemId === currentSystemId`
  (`src/systems/quests/deliveryCompletion.ts`) — so the system id is known; it's
  just not shown or actionable in the UI.
- **Route plotting already exists** for planets/stations: in flight,
  `SpaceFlightScene.planRouteTo` / the station route button
  (`PlanetManager.routeTargetStationId`), and cross-system travel is the star-map
  warp (`StarMapScene.performWarpJump`). The new button reuses these — it does not
  invent routing.
- **Where the objective is shown:** the quest journal / objective UI (find the
  active-quest panel that lists objectives) names the planet; it must also resolve
  `targetSystemId` → system name and host the button.

## Development Approach
- **Testing approach: TDD.** A pure helper resolves a quest objective to a
  `{systemId, systemName, planetId, planetName, sameSystem}` destination
  descriptor (tested against the galaxy), and a pure decision picks the route
  action (in-system approach vs cross-system warp). The button wiring is then thin.
- Additive UI + reuse of existing routing. No domain/schema/save change. Run
  `impact` on the quest-journal objective render + `planRouteTo`/`performWarpJump`.

## Testing Strategy
- **Unit:** destination descriptor resolves system name from `targetSystemId`;
  `sameSystem` true iff `targetSystemId === currentSystemId`; the route-action
  decision returns "approach planet" when same-system, "warp toward system" when
  not (and handles a null `targetPlanetId`).
- **Real-engine playtest:** clicking the button plots an in-flight route to the
  planet when in-system, or initiates the star-map warp toward the target system
  otherwise; no thrown/logged errors.

## Implementation Steps

### Task 1: Pure quest-destination resolver + route-action decision
**Files:**
- Create: `src/systems/quests/questDestination.ts`
- Create: `src/tests/quests/questDestination.test.ts`

- [x] `questDestination(quest, galaxy, currentSystemId)` → `{ systemId,
      systemName, planetId, planetName | null, sameSystem }` (resolves names from
      the galaxy; tolerates a null `targetPlanetId`).
- [x] `questRouteAction(dest)` → `{ kind: "approach-planet", planetId }` when
      `sameSystem`, else `{ kind: "warp-to-system", systemId }`.
- [x] write tests for both (same-system, cross-system, null planet, unknown id).
- [x] run tests — green.

### Task 2: Show the system name on the objective
**Files:**
- Modify: the quest journal / active-objective UI (e.g. `src/presentation/QuestJournalUI.ts`)

- [x] For objectives with a `targetSystemId`, render the **system name** next to
      the planet (e.g. «Вернуться: <planet> — система <system>») via
      `questDestination`.
- [x] write/extend a UI-content test asserting the system name appears for a
      return/target objective.
- [x] run tests — green.

### Task 3: «Проложить маршрут» button → existing routing
**Files:**
- Modify: the quest journal UI + `src/presentation/SpaceFlightScene.ts` (route hook)

- [x] Add a plot-route button on actionable quest objectives; on click, run
      `questRouteAction` and dispatch to the existing flight route
      (`planRouteTo`/approach the planet) when same-system, or initiate the
      star-map warp toward `systemId` when not.
- [x] write tests: the button dispatches the correct route action per
      same/cross-system; disabled/hidden when the quest has no target.
- [x] run tests — green.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only the quest
      destination helper + quest UI + the flight route hook affected.
- [ ] full unit suite green; `npm run test:playtest` green; lint clean; build ok.

### Task 5: Update documentation
**Files:**
- Modify: `docs/` or a quest-system note

- [ ] Note the quest-destination resolver + the plot-route button reusing the
      existing in-system route / star-map warp.

## Technical Details
- Pure resolver + reuse of existing routing seams; no new navigation logic, no
  domain/schema/save change. Cross-system routing defers to the star-map warp the
  player already uses.

## Post-Completion
**Manual verification:** take a quest that returns to a planet in another system →
the objective names the system and the «Проложить маршрут» button warps toward it,
then approaches the planet in-system.
