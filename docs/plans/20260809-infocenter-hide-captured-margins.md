# InfoCenter: hide trade tips pointing into captured systems

## Overview

The InfoCenter's trade-rumor panel ("Инфоцентр") recommends cross-system arbitrage
routes by margin, but the pipeline never checks whether a route's origin/destination
system is currently held by the Overmind or pirates. Result: a player follows a
high-margin tip, flies there, and finds the system captured — the trade is
unreachable/pointless and the tip was noise.

This plan filters captured (`galaxy.isHostileSystem(id)`) systems out of the trade-tip
pipeline at two points:
1. **Source** — `scanTradeRoutes` never proposes a route touching a hostile system, so
   new rumors never open into one.
2. **Display** — `buildRumorPanel` (and its news-feed echo `feedEventVisible`) drops any
   *already-open* rumor/news line touching a system that became hostile after the rumor
   opened, so the panel reflects current capture state immediately rather than waiting
   for the next daily rescan (`RumorDirector.updateRumors` already expires a rumor whose
   route drops out of `scanTradeRoutes`'s candidates, but only on the next day tick).

No domain/schema/save changes — this is pure filtering logic over existing
`Galaxy.isHostileSystem(id)` state (Overmind/pirate capture), already used for the same
kind of exclusion in `GameEngine.resolveCampaignChainTarget` and `NpcGarrisonCombat`.

## Context (from discovery)

- **`src/systems/trade/RouteScanner.ts`** `scanTradeRoutes(galaxy, priceFn, opts)` —
  iterates `galaxy.systems` unconditionally, builds per-resource `PricePoint[]`, picks
  best cross-system buy/sell pair via `bestCrossSystemRoute`. No eligibility filter.
- **`src/systems/trade/RumorDirector.ts`** `updateRumors(galaxy, scanFn, day, cfg)` —
  re-scores `galaxy.activeRumors` against a fresh `scanFn()` call each day tick. A rumor
  whose id no longer appears in `candidates` gets `lastMarginPct = 0` and expires that
  tick (`<= cfg.marginExpire`). So once Task 1 excludes hostile systems from
  `scanTradeRoutes`, an existing rumor into a system captured today will self-expire on
  tomorrow's `advanceTradeRumors` tick — but stays visible in the panel until then.
- **`src/presentation/rumorPanel.ts`** `buildRumorPanel(galaxy, max, player, hideUnknown)`
  — reads `galaxy.getActiveRumors()`, filters by `isSystemKnown` when `hideUnknown &&
  player`. This is the actual InfoCenter panel data builder; also has
  `feedEventVisible`/`maskTradeNewsMargin` for the news-feed echo of the same rumors.
  Precedent doc: `src/presentation/CLAUDE.md` → "InfoCenter trade margins respect
  partial observability" (`docs/plans/20260625-infocenter-margin-known-systems-only.md`).
- **`src/presentation/InfoCenterScene.ts`** `renderRumorPanel()` — calls
  `buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player, true)`. No change needed here; the
  fix lives entirely in `rumorPanel.ts`/`RouteScanner.ts`.
- **`Galaxy.isHostileSystem(id)`** (`src/domain/Galaxy.ts`) — `isOvermindSystem(id) ||
  isPirateSystem(id)`. The existing exclusion predicate used elsewhere
  (`GameEngine.resolveCampaignChainTarget`, `NpcGarrisonCombat` throughout).
- **Gotcha found during discovery:** `src/tests/trade/routeScanner.test.ts`'s
  `makeGalaxy(systems)` helper builds a **plain object** cast `{ systems } as unknown as
  Galaxy` — it has no `isHostileSystem` method. If `scanTradeRoutes` calls
  `galaxy.isHostileSystem(id)` directly, every existing test using this fixture throws
  at runtime (`galaxy.isHostileSystem is not a function`), not just fails an assertion.
  Task 1 below fixes this by extending `makeGalaxy` to default-supply
  `isHostileSystem: () => false` (existing tests keep passing unchanged) and add an
  optional hostile-id set for the new test — an **additive** helper change, not a
  weakened assertion (see standing rule: never modify/weaken existing test assertions).

## Development Approach
- **Testing approach**: TDD (write the failing test first, then make it pass).
- Complete each task fully before moving to the next.
- Make small, focused changes — no refactor of `RouteScanner`/`rumorPanel` beyond what's needed.
- Do not touch any existing test assertion; only additive fixture/helper changes are allowed.
- Run `npm test -- --run` after each task; all tests (old + new) must pass before moving on.

## Testing Strategy
- **Unit tests**: `src/tests/trade/routeScanner.test.ts` (scan-time exclusion) and
  `src/tests/info/infocenterMarginVisibility.test.ts` or
  `src/tests/presentation/infoCenterRumors.test.ts` (display-time exclusion) — both
  follow existing patterns in those files (plain-object `Galaxy` fixture for the scanner,
  `RealEngineHarness` + `galaxy.addOvermindSystem`/`addPirateSystem` for the panel).
- No E2E test needed — this is pure data-filtering logic with existing unit-test coverage
  patterns for both layers; no new pointer/render interaction is introduced.

## Implementation Steps

### Task 1: Exclude hostile (captured) systems from `scanTradeRoutes`
- [x] In `src/tests/trade/routeScanner.test.ts`, extend `makeGalaxy` to accept an
      optional `hostileIds: string[]` param and return
      `{ systems, isHostileSystem: (id) => (hostileIds ?? []).includes(id) } as unknown as Galaxy`
      (default `hostileIds` empty — all existing call sites/tests unaffected).
- [x] Write a failing test: two systems with a 50%+ margin route where the destination
      (or source) system is in `hostileIds` — assert `scanTradeRoutes` returns `[]` (or
      omits that route) instead of proposing it.
- [x] In `src/systems/trade/RouteScanner.ts`, skip `PricePoint`s from any system where
      `galaxy.isHostileSystem(system.id)` is true when building `byResource` (in the
      `for (const system of galaxy.systems)` loop, before/alongside the existing
      `if (!market) continue;` checks).
- [x] Write a test asserting a route between two *non-hostile* systems is unaffected when
      a third, unrelated hostile system exists in the galaxy (no over-filtering).
- [x] run tests (`npm test -- --run src/tests/trade/routeScanner.test.ts`) — must pass
      before Task 2.

### Task 2: Drop already-open rumors/news touching a now-hostile system in the InfoCenter panel
- [x] In `src/tests/info/infocenterMarginVisibility.test.ts` (or a new sibling test file
      if scope diverges), write a failing test: boot `RealEngineHarness`, seed
      `galaxy.activeRumors` with a rumor whose `toSystemId` is a real system, call
      `galaxy.addOvermindSystem(toSystemId)` (or `addPirateSystem`), then assert
      `buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player)` returns **no line** for that
      rumor (not just a masked margin).
- [x] In `src/presentation/rumorPanel.ts` `buildRumorPanel`, add an unconditional filter
      (runs regardless of `hideUnknown`/`player`, since capture state isn't
      player-knowledge-gated) dropping any rumor where
      `galaxy.isHostileSystem(r.fromSystemId) || galaxy.isHostileSystem(r.toSystemId)`,
      applied before the existing `isSystemKnown` filtering.
- [x] Write a failing test for `feedEventVisible`: a `TRADE_OPPORTUNITY` news event whose
      `fromSystemId`/`toSystemId` is hostile — assert it returns `false`.
- [x] In `feedEventVisible`, extend the existing `TRADE_OPPORTUNITY` branch to also
      return `false` when `galaxy.isHostileSystem(event.fromSystemId) ||
      galaxy.isHostileSystem(event.toSystemId)`.
- [x] Write a test confirming a rumor between two *non-hostile* systems still renders
      normally (masked or unmasked per existing known/unknown behavior) — no regression
      to the `20260625-infocenter-margin-known-systems-only` masking feature.
- [x] run tests (`npm test -- --run src/tests/info src/tests/presentation`) — must pass
      before Task 3.

### Task 3: Verify acceptance criteria
- [ ] verify a route/rumor into an Overmind-held system never appears as a fresh
      InfoCenter tip (Task 1) and disappears immediately from an already-open tip once
      the system is captured (Task 2), without waiting for the next day tick
- [ ] verify a route/rumor into a pirate-held system is equally excluded
      (`isHostileSystem` covers both `isOvermindSystem`/`isPirateSystem`)
- [ ] verify non-hostile routes/rumors are completely unaffected (no over-filtering) and
      the existing known/unknown masking behavior (`infocenterMarginVisibility.test.ts`)
      still passes untouched
- [ ] run full unit test suite (`npm test -- --run`) — must pass
- [ ] run linter (`npm run lint`) — all issues fixed
- [ ] run `mcp__gitnexus__detect_changes` (`scope: "compare", base_ref: "master"`) and
      confirm the affected symbols/flows are limited to `RouteScanner`, `RumorDirector`
      (read-only, unchanged), `rumorPanel.ts`, and their tests

### Task 4: [Final] Update documentation
- [ ] extend the "InfoCenter trade margins respect partial observability" section in
      `src/presentation/CLAUDE.md` with a short addendum noting margins/rumors are also
      unconditionally excluded for hostile (Overmind/pirate-captured) systems, separate
      from the known/unknown masking, with a pointer to this plan

## Technical Details

- `Galaxy.isHostileSystem(id: string): boolean` — no new method needed, already exists
  at `src/domain/Galaxy.ts` (`isOvermindSystem(id) || isPirateSystem(id)`).
- `RouteScanner.scanTradeRoutes` signature is unchanged (`galaxy` already passed in) —
  the filter reads `galaxy.isHostileSystem`, no new parameter.
- `rumorPanel.buildRumorPanel`/`feedEventVisible` signatures are unchanged — both
  already receive `galaxy` as a parameter.
- No new domain field, no schema change, no migration, no `CURRENT_VERSION` bump —
  `overmindSystems`/`pirateSystems` are already-persisted `Galaxy` fields this plan only
  reads.

## Post-Completion

**Manual verification** (optional, not required to ship):
- In a real playthrough (or via dev autopilot `` ` ``), let the Overmind capture a system
  that currently has an active high-margin InfoCenter rumor pointing into it, and confirm
  the tip disappears from the panel without needing to wait a day-tick / reopen the scene.
