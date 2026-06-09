---
# Sprint 2: Flight & UI Polish

## Overview
Polish pass across space flight, star map, planet scene, trade market, info center, and job board based on playtesting feedback. Fixes a critical fog-of-war bug (all systems showing "?"), improves pathfinding (route disappears, sun avoidance), adds time-scale control, enriches planet hover tooltips, polishes the planet scene visuals, fixes info center search, adds market QoL (max cargo, price highlights), and upgrades job board text with humorous governor-style quest descriptions.

## Context
Key files:
- `src/presentation/SpaceFlightScene.ts` — routing, sun avoidance, ship movement, solar flares
- `src/presentation/StarMapScene.ts` — fog of war, system labels, visibility tiers
- `src/presentation/PlanetScene.ts` — planet landing UI, panorama, services
- `src/presentation/TradeScene.ts` — market UI
- `src/presentation/InfoCenterScene.ts` — equipment/goods search
- `src/presentation/JobBoardPanel.ts` — quest panel
- `src/systems/quests/QuestGenerator.ts` — quest description generation
- `src/config/balance.ts` — game speed, ship speed constants
- `src/domain/Player.ts` — `markVisited()`, `visitedSystems`
- `src/systems/GameEngine.ts` — new-game init, scene transitions
- `src/utils/starMapUtils.ts` — `getSystemVisibility()`
- `e2e/` — E2E tests

Related: US-070, US-071, US-072, US-074, US-075

## Development Approach
- Fix bugs first (Tasks 1-3), then polish (Tasks 4-9), then verify (Task 10)
- Each task: implement → write/update tests → run lint → commit
- Follow all PixiJS event rules from CLAUDE.md (stopPropagation, eventMode, etc.)
- No hardcoded pixel coordinates for click detection

## Implementation Steps

### Task 1: Fix fog-of-war — all systems show "?"
**Files:**
- Modify: `src/systems/GameEngine.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] In `GameEngine` new-game init (around line 298), call `player.markVisited(player.currentSystemId)` immediately after setting `currentSystemId` so starting system is in `visitedSystems` before any scene opens
- [x] Also call `player.markVisited` on `loadGame` after restoring `currentSystemId` (line 708-719 area) when `visitedSystems` is empty as migration guard
- [x] Verify `getSystemVisibility` returns `"visited"` for the starting system and `"neighbor"` for connected systems in unit test `src/tests/starMapVisibility.test.ts` (added fresh-player test cases)
- [x] Run `npm test -- --run src/tests/starMapVisibility.test.ts` — must pass

### Task 2: Fix route building — disappears on first click, endpoint behind planet
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Trace route-click handler: find where route is built and why it clears immediately on first click (likely a double-event: pointerdown + pointerup both fire and the second cancels the first)
- [x] Fix event handling: build route on `pointerup` (or check `hasDragged` flag before clearing), ensure single click commits route
- [x] Fix endpoint position: route destination should be at planet orbit radius, not at planet center (so the path ends just before the planet disc)
- [x] Write unit/integration test verifying route survives a single click (mock event sequence)
- [x] Run `npm test -- --run` — must pass

### Task 3: Sun orbit — smooth avoidance + hull damage on contact
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/config/balance.ts`

- [x] Replace hard-blockade sun avoidance with soft steering: when pathfinding through or near sun, bend the route in an arc around the exclusion radius (`avoidStarPath` builds a Catmull-Rom arc tangent to the sun circle; waypoints now radially clamped so they never dip inside `SUN_EXCLUSION_RADIUS`)
- [x] Add `SUN_EXCLUSION_RADIUS` and `SUN_CONTACT_HULL_DAMAGE` constants to `balance.ts` (exclusion aliases `SYSTEM_GEOMETRY.starAvoidRadius` = 390px to keep one source of truth at the game's 5x scale; 5 hull damage per contact tick, plus `SUN_CONTACT_DAMAGE_INTERVAL_MS` = 500)
- [x] Each movement tick: if ship center is within sun radius, apply `SUN_CONTACT_HULL_DAMAGE` to player hull (discrete accumulator applies one chunk per `SUN_CONTACT_DAMAGE_INTERVAL_MS` of game time — no frame-by-frame drain)
- [x] Route preview line must visually arc around sun (not cut through it) — `drawRouteLine` renders `routePath`, the same clamped avoidance arc
- [x] Write test: `pathfindAroundSun()` produces waypoints that never enter exclusion radius (`src/tests/sunAvoidance.test.ts` covers `avoidStarPath` clearance + rate-limited burn)
- [x] Run `npm test -- --run` — must pass (720 tests pass)

### Task 4: Planet hover tooltip — immediate name, habitability, faction, owner
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Show tooltip on `pointerover` (not just on click): display planet name, habitability status ("Обитаемая" / "Необитаемая"), faction name in faction color, and relation to player (ally/neutral/hostile) — `buildPlanetTooltipLines` now emits the controlling faction name in its faction colour on its own line, with the player relation on the next line in reputation colour
- [x] If planet `ownerFaction === "PIRATES"` or `ownerFaction === "OVERMIND"`, show that explicitly ("Захвачена Пиратами" / "Захвачена Овермайндом") in red — codebase has no PIRATES faction; OVERMIND (and any captor) gets a red "⚠ Захвачена: <captor>" warning line
- [x] Tooltip must appear within 50ms of hover (no delay), hide on `pointerout` — `showPlanetTooltip` renders synchronously on `pointerover` (no setTimeout), `hideTooltip` on `pointerout`
- [x] Tooltip must not block clicks underneath (use `eventMode = 'none'` on tooltip text elements, `stopPropagation` not needed as it's a static overlay) — container, bg, and all text nodes set `eventMode = 'none'`
- [x] Add E2E/unit test: hover over planet → tooltip text contains planet name — `src/tests/planetTooltip.test.ts` now exercises the real `buildPlanetTooltipLines` helper (name, habitability, faction colour, relation, capture warning); 11 cases
- [x] Run `npm test -- --run` — must pass (722 tests pass)

### Task 5: Star map — non-straight routes and route not strictly linear
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Route line should show arc/curve when path bends around sun (use PixiJS bezier or multi-segment polyline matching computed waypoints) — `drawRouteLine` already dashes along the curved `routePath` (Catmull-Rom arc from `avoidStarPath`); added a route-arc test asserting the rendered polyline is multi-segment, clears the exclusion radius, and bows well off the straight chord
- [x] During landing approach (entering planet orbit), animate ship on a curved spiral-in path instead of a straight line to the planet center — new `spiralApproachPath` curves the approach to the orbit-edge point; `computeFlightPath` uses it for planet destinations when the shot is otherwise straight (when it already bends around the star it is curved enough); wired into `onPlanetClick` plan + execute
- [x] During take-off, animate ship on a short outward arc before engaging autopilot — new `takeoffArcPath` + cosmetic `updateTakeoff` walk: on re-entry from a planet (`fromPlanetId`) the ship lifts off the disc edge and arcs out ~90px; physics stays parked at the arc end so no game-days burn; a fresh course (`executeRouteTo`) cancels it
- [x] When approaching NPC ship (intercept), path curves to lead the target rather than heading directly at its current position — new `leadInterceptPoint` (quadratic lead solve) + `npcLeadPoint`; both the initial intercept (`onAttackNpc`) and each chase leg (`updateCombat`) re-aim at the predicted lead, so the pursuit curves to lead a crossing target
- [x] Run `npm test -- --run` — must pass (735 tests pass)

### Task 6: Planet scene visual polish
**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [ ] Panorama background: implement horizontal pan with mouse drag (mouseX delta → sprite.x offset clamped to panorama width − screen width), so the user can "look around" as described
- [ ] Ensure panorama fills full screen height, overflows horizontally; clamp pan so edges are never visible (panorama is 4096px wide, screen ~1280px → 2816px of pan range)
- [ ] Planet sphere (top-left decorative orb): increase size, add subtle rotation animation using `PlanetRotationFilter` if available, else simple UV scroll
- [ ] Service buttons: use consistent `UiButton` component with proper spacing; show faction banner color as accent on header
- [ ] Planet name header: larger font, faction color, with subtitle showing planet type and habitability
- [ ] Fallback when no panorama asset exists: gradient sky matching faction color palette instead of flat black
- [ ] Write test: `visiblePlanetServices` correctly hides services for uninhabited planet (existing test — verify still passes)
- [ ] Run `npm test -- --run` — must pass

### Task 7: Job board — richer quest text + governor dialogue entry
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/presentation/JobBoardPanel.ts`
- Modify: `src/presentation/PlanetScene.ts`

- [ ] `QuestGenerator`: enrich quest `description` field with humorous, story-rich text — add 5+ description templates per quest type (DELIVERY, PATROL, BOUNTY, ESCORT) with variable substitution (sender name, goods, reason, reward framing); match the terse-but-funny tone of original Space Rangers
- [ ] `QuestGenerator`: add `issuerName` and `issuerTitle` fields to generated quest (e.g. "Губернатор Маклай", "Торговец Зорба"); used in panel header
- [ ] `JobBoardPanel`: show issuer name/title in panel header when available; show full description text (scrollable if needed)
- [ ] `PlanetScene`: add "Губернатор" button (if planet is habitable) that opens a governor dialogue panel listing available quests — same underlying quests as job board but framed as NPC dialogue lines (governor "offers" the mission in first person)
- [ ] Write test: every quest type produces a non-empty description with at least 50 characters
- [ ] Run `npm test -- --run` — must pass

### Task 8: Info center fixes — search, money display, equipment facets, comparison
**Files:**
- Modify: `src/presentation/InfoCenterScene.ts`

- [ ] Fix search: goods/equipment search must return results (debug why nothing is found — likely missing index or wrong field name)
- [ ] Equipment results: show planet name + system name next to each listing, not just station ID
- [ ] Player money: show player credits balance prominently in top bar of info center (same pattern as trade scene)
- [ ] Equipment faceted filter: add filter chips for equipment type (engine, shield, radar, laser, hull, fuel tank); clicking a chip narrows results; chips are toggle-able, multi-select
- [ ] Equipment comparison: when viewing equipment search results, show current installed equipment of same type in a "vs" sidebar panel (slot type, key stats side-by-side)
- [ ] Goods search: show price delta vs player's current system price (▲ / ▼ %)
- [ ] Write tests: search returns results for known item type; facet filter reduces result set; comparison panel shows correct slot type
- [ ] Run `npm test -- --run` — must pass

### Task 9: Trade market — max cargo button + price highlight icons
**Files:**
- Modify: `src/presentation/TradeScene.ts`

- [ ] Add "Макс" button next to quantity input for each commodity row — clicking it sets quantity to the maximum the player can afford AND fit in cargo hold (min of: credits/price, free hold space)
- [ ] Highlight commodities with exceptionally good buy price (< 70% of galactic average) with a small green ▼ icon overlaid on the "Купить" button
- [ ] Highlight commodities with exceptionally good sell price (> 130% of galactic average) with a small gold ▲ icon overlaid on "Продать"
- [ ] Price average baseline: use `GalaxySimulator` commodity price data or a simple hardcoded baseline from `balance.ts`
- [ ] Write test: `computeMaxBuyQty(price, credits, freeHold)` returns correct value for edge cases (0 credits, 0 hold, exact fit)
- [ ] Run `npm test -- --run` — must pass

### Task 10: Verify all acceptance criteria
**Files:**
- Read: `e2e/phase-2-living-galaxy.spec.ts`, `e2e/phase-4-beta-release.spec.ts`

- [ ] Star map: starting system shows real name, adjacent systems shown as dim dots (neighbor), truly unknown systems hidden — verify with `window.__gameEngine.player.visitedSystems`
- [ ] Route: click planet once → route appears and stays; ship follows arc around sun
- [ ] Sun contact: move ship into sun → hull decreases
- [ ] Planet hover: tooltip appears immediately with name and faction
- [ ] Planet scene: panorama pans with mouse drag; service buttons visible and clickable
- [ ] Job board: quest descriptions are > 50 chars, include humor; governor button opens dialogue
- [ ] Info center: search for "engine" returns results; player credits shown; faction filter narrows results; comparison panel shown
- [ ] Trade: "Макс" button computes correct quantity; price icons visible on favorable goods
- [ ] Run `npm run lint` — 0 errors
- [ ] Run `npm test -- --run` — all pass
- [ ] Run `npm run test:e2e` — existing tests pass (no regressions)

## Technical Details

**Fog-of-war fix (Task 1):**
In `GameEngine.ts` around `initNewGame()`:
```typescript
this.player.currentSystemId = this.galaxy.systems[0].id;
this.player.markVisited(this.player.currentSystemId); // ← add this
```

**Route endpoint fix (Task 2):**
Route destination = `planet.position + normalize(ship → planet) * planet.orbitRadius`
so the endpoint is at the orbit edge, not the planet center.

**Sun arc waypoint (Task 3):**
When straight path intersects sun exclusion circle, insert two tangent waypoints:
- entry tangent = point on circle 90° before intersection
- exit tangent = point on circle 90° after intersection

**Panorama pan (Task 6):**
```typescript
this.app.stage.on('pointermove', (e) => {
  if (!this.isPanning) return;
  const dx = e.global.x - this.lastPanX;
  this.panoramaSprite.x = clamp(
    this.panoramaSprite.x + dx,
    -(PANORAMA_WIDTH - SCREEN_WIDTH),
    0
  );
  this.lastPanX = e.global.x;
});
```

**Max buy quantity (Task 9):**
```typescript
function computeMaxBuyQty(price: number, credits: number, freeHold: number): number {
  return Math.min(Math.floor(credits / price), freeHold);
}
```

## Post-Completion
- Manual playtest: fly through multiple systems, open star map, verify no "?" on starting system
- Manual playtest: click planet, confirm route stays; fly near sun, confirm arc and hull loss
- Manual playtest: land on planet, drag panorama, open governor dialogue
- Manual playtest: open info center, search equipment, verify comparison and filter
- Manual playtest: open market, click Макс, verify quantity; check price icons on favorable trades
