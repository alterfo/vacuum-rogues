---
# Populate Planet Markets (EPIC-001)

## Overview
Every planet currently gets `new Market([], [], [])` (an empty stub from
`PlanetGenerator.createStubMarket`), so `availableResources` is empty. That makes
the entire dynamic-pricing layer inert in production: `advanceMarketDay` loops
zero times, `applyMarketTradeImpact` early-returns on `indexOf < 0`, daily
price-events do nothing, and `getMarketPrice` never multiplies by
`priceMultipliers`. Prices are therefore **static per planet** — the arbitrage
the player exploits structurally never self-corrects. This plan seeds each
planet's market with real `availableResources` + `supply`/`demand` vectors
(deterministically, by economy type), so the already-shipped economy machinery
(drift toward 1.0, trade impact, the rumors plan) finally has something to act
on. It also hides the `availableResources` index coupling behind a resource-keyed
accessor so future callers don't depend on array position.

## Context
- **Empty stub:** `src/systems/PlanetGenerator.ts` `createStubMarket()` →
  `new Market([], [], [])`; planets built in `generatePlanets()`.
- **Economy assignment point:** `src/systems/GalaxySimulator.ts` already iterates
  planets and sets `planet.market.economyType` (≈L86, and override ≈L627). That is
  the natural place to populate the market once the economy type is known.
- **Pricing:** `src/systems/TradeSystem.ts` `getMarketPrice()` indexes
  `availableResources`/`demandVector`/`supplyVector`/`priceMultipliers`;
  `economyBaseline(economyType, resource)` in `src/domain/Market.ts`.
- **Dynamic layer (already built):** `Market.advanceMarketDay()` (reverts to 1.0),
  `applyMarketTradeImpact()` (pure, resource-keyed), `Market.getPrice()`.
- **Persistence:** the galaxy saves through `SaveStateSerializer`'s plain
  `JSON.stringify`/`JSON.parse`, **not** `GalaxySchema.parse`. `StarSystemSchema`
  has no `planets`/market sub-schema (`L274` is the *system's* `economyType`, not a
  market field), so market vectors persist as raw JSON and are not Zod-validated.
  This plan adds **no new persisted field** (the arrays already existed, just
  empty), so no schema migration is required.
- **Known gap (follow-up):** population runs only at fresh generation. Saves
  created before this feature keep empty stub markets and the load path only
  restores prototypes, so the dynamic layer stays inert on those saves. A
  load-time re-seed of empty markets in `GameEngine.rehydrateLoadedState` is the
  follow-up — best landed together with the market-rehydration prototype fix.
- **Tests:** existing economy tests (`economy.test.ts`, `tradeSystem.test.ts`,
  `economy/marketDynamics.test.ts`) construct markets explicitly with resources,
  so they are unaffected by populating *production* markets. Add new tests.

## Development Approach
- **Testing approach: TDD (tests first).**
- Population is a **pure, deterministic** function seeded by `galaxy.id + planetId`
  so saves/replays are stable; no PixiJS/DOM/ONNX in domain.
- Keep the existing array data shape (avoids a save migration). Add a resource-keyed
  accessor seam on `Market` so callers stop using raw indices (orthogonality), but
  do **not** rip out the arrays.
- Do not modify existing test assertions; add new tests only.
- One concern per task; each task green before the next.

## Testing Strategy
- Unit: population determinism, per-economy resource bias, vector bounds.
- Integration: a populated market now responds to `advanceMarketDay` (multiplier
  moves) and to `executeTrade` (price shifts; cross-planet arbitrage narrows).
- No E2E required (no UI change); the trade screen already renders all resources.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep this file in sync.

## Implementation Steps

### Task 1: Resource-keyed accessor seam on Market
**Files:**
- Modify: src/domain/Market.ts (add `hasResource(r)`, `multiplierFor(r)`, and make
  `applyMarketTradeImpact` the canonical resource-keyed mutator — already is)
- Create: src/tests/economy/marketAccessors.test.ts

- [x] add `Market.hasResource(resource)` and `Market.multiplierFor(resource)` that
      resolve by `ResourceType`, returning safe defaults when absent
- [x] write tests: present/absent resource, default when empty
- [x] run affected tests — must pass before next task

### Task 2: Deterministic market-population function
**Files:**
- Create: src/systems/galaxy/marketSeeding.ts (`seedMarket(economyType, planetId, rng)`
  → `{ availableResources, supplyVector, demandVector }`)
- Create: src/tests/galaxy/marketSeeding.test.ts

- [x] choose which resources a planet trades (all 10, or a deterministic subset) and
      seed `supply`/`demand` biased by economy type (e.g. AGRICULTURAL → high ORGANICS
      supply, scarce ELECTRONICS) so cross-planet spreads exist and make sense
- [x] deterministic from `planetId` (stable across save/load); vectors clamped > 0
- [x] write tests: determinism, per-economy bias direction, bounds
- [x] run affected tests — must pass before next task

### Task 3: Wire population into galaxy generation
**Files:**
- Modify: src/systems/GalaxySimulator.ts (after each `planet.market.economyType = …`,
  fill `availableResources`/`supplyVector`/`demandVector` via `seedMarket`)
- Modify: src/systems/PlanetGenerator.ts only if the seed must move there
- Create: src/tests/galaxy/marketPopulation.test.ts

- [x] populated markets for every planet after `generateGalaxy`; `priceMultipliers`
      length matches `availableResources`
- [x] write test: generated galaxy has non-empty markets; round-trips through
      `schemas.ts` validation
- [x] run affected tests — must pass before next task

### Task 4: Confirm the dynamic layer now engages
**Files:**
- Create: src/tests/economy/livePricing.test.ts

- [x] integration test on a generated (populated) planet: `advanceMarketDay` moves a
      multiplier; `executeTrade` shifts price via `applyMarketTradeImpact`; repeated
      cross-planet round-trips narrow the spread (extends marketDynamics intent)
- [x] regression: same-planet buy→sell still loses credits (SELL_SPREAD intact)
- [x] run affected tests — must pass before next task

### Task 5: Verify acceptance criteria
- [x] verify Overview: production markets non-empty; drift/impact/events act on them
      (GalaxySimulator L89/L632 call `planet.market.populate(seedMarket(...))`;
      livePricing.test.ts + marketPopulation.test.ts prove non-empty markets respond
      to advanceMarketDay/executeTrade)
- [x] run full unit suite — all green (1522 tests / 176 files pass)
- [x] run `npm run lint` — clean (0 errors; 31 pre-existing `any` warnings confined to
      unrelated quest test files, none in market code)
- [x] confirm no existing test assertions changed (quest-test diffs are additions only,
      zero removed lines; this plan only created new test files)

## Technical Details
- Seeding bias: derive supply/demand from `economyBaseline(economyType, resource)`
  inverse (cheap baseline ⇒ abundant supply) plus a per-planet jitter from `planetId`,
  so the static `econMult` and the dynamic vectors agree in direction.
- Determinism: `hashStr(planetId)`-seeded RNG; never `Math.random`.

## Post-Completion
**Manual verification:** play a few days, confirm prices visibly drift and that a
route you keep running gets less profitable over time (self-correcting). This plan
is the prerequisite for `20260616-living-trade-economy-rumors.md`.
