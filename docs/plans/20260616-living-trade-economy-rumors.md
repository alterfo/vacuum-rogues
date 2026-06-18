---
# Living Trade Economy: Route Rumors + Reactive NPC Traders

## Overview
Give the galaxy a self-balancing "trade-rush" loop. A daily **route scanner** finds
the best buy-low → sell-high opportunities and publishes them as **TRADE_OPPORTUNITY
rumors** the player can read ("Везите <товар> из <A> в <B>: маржа ~N%"). NPC traders
**see the same rumors** and divert onto a route with a probability that scales with its
margin. Player **and** NPC trades both push the persistent `priceMultipliers` through the
shared `Market.applyTradeImpact()` lever, so the route's spread closes over a few days; as
the margin drops the rumor **expires** ("акция закончилась") and the NPC flow tapers off.
The net effect: arbitrage exists and is discoverable, but it self-corrects instead of
running away — directly fixing the "where it's cheap gets cheaper / where I sell gets
dearer" complaint and making the economy feel alive.

This builds on already-shipped pieces: `Market.applyTradeImpact()`/`advanceMarketDay()`
(mean-reverting to 1.0), `TradeSystem.getMarketPrice()` deterministic per-planet spreads,
`Galaxy.addNewsEvent()` feed, and `NpcSimulator` trader NPCs that already carry cargo and
trade on arrival.

## Context
- **Pricing:** `src/systems/TradeSystem.ts` — `getMarketPrice()` (base × modifier ×
  `planetPriceFactor(planetId)` × econMult × `priceMultipliers`). Player buy/sell already
  call `Market.applyTradeImpact()` via `TradeSystem.tradeImpact(amount)`.
- **Market state:** `src/domain/Market.ts` — `priceMultipliers` (dynamic layer, clamp
  [0.4,2.5]), `advanceMarketDay()` reverts toward 1.0, `applyTradeImpact(resource, delta)`.
- **News feed:** `src/domain/Galaxy.ts` — `addNewsEvent(NewsEvent)`, `newsFeed` (trimmed
  to `NEWS_FEED_MAX`). `NewsEvent` union in `src/types/index.ts:219` (needs a new
  `TRADE_OPPORTUNITY` variant). Surfaced in `src/presentation/InfoCenterScene.ts`.
- **Daily tick:** `src/systems/GameEngine.ts` `advanceGalaxyDay()` (~L405–435) already
  loops systems, calls `advanceMarketDay()`, emits generic `MARKET_SHIFT` news, and runs
  `npcSimulator.tick()` / `galaxySimulator.tickGlobalEvents()`.
- **NPC traders:** `src/systems/npc/NpcSimulator.ts` — `pickTraderCargo()` (cheapest
  goods), `simulateTraderTrade()` (shifts `supplyVector` only), per-day move chance.
- **Balance constants:** `src/config/balance.ts` `GAME_BALANCE` (`marketImpactPerUnit`,
  `marketImpactMaxPerTrade`, `tradeDealThreshold`).
- **Persistence:** `src/validation/schemas.ts` — any `src/types`/`src/domain` field added
  to a saved object (Galaxy rumors) must be schema-mirrored or saves break.
- **Tests:** `src/tests/economy/marketDynamics.test.ts`, `globalEvents.test.ts`,
  `tradeSystem.test.ts`, NPC sim tests under `src/tests/`. Existing assertions are
  known-good — add new tests, never weaken existing ones.

## Development Approach
- **Testing approach: TDD (tests first)** per repo rule — write the failing red test, then
  implement to green; visually verify only the UI task via screenshot.
- One concern per task; each task ends green before the next starts.
- Domain stays PixiJS/ONNX/DOM-free. Strict layer direction (presentation → systems →
  domain). Scanner/rumor logic is a pure system/domain function (unit-testable, seedless or
  seeded-deterministic).
- Reuse `applyTradeImpact` and `GAME_BALANCE`; add new tunables rather than magic numbers.
- Keep the same-planet no-arbitrage invariant (`SELL_SPREAD`) intact — covered by an
  explicit regression test.
- Determinism: rumor selection seeded from `galaxy.id + gameDays`; NPC reaction draws from
  the existing `SeededRNG` so saves/replays are stable.

## Testing Strategy
- **Unit tests** required per task (scanner ranking, rumor lifecycle/expiry, NPC reaction
  probability, NPC market impact convergence, balance invariants).
- **Convergence test:** simulate N days of player+NPC trading a seeded route and assert the
  margin monotonically shrinks below the expiry threshold and the rumor closes.
- **E2E:** add a regression check that a TRADE_OPPORTUNITY rumor renders in the news/Info
  Center panel (`e2e/` or `playtest-regression.spec.ts`) for the UI task.

## Progress Tracking
- Mark `[x]` immediately when done; ➕ for newly discovered tasks; ⚠️ for blockers.
- Keep this file in sync if scope shifts during implementation.

## Implementation Steps

### Task 1: Trade-route scanner (pure ranking function)
**Files:**
- Create: src/systems/trade/RouteScanner.ts
- Modify: src/systems/TradeSystem.ts (add `referenceMarketPrice(planet, resource)` —
  faction/rank-neutral price, no `Player`)
- Create: src/tests/trade/routeScanner.test.ts

- [x] add `TradeSystem.referenceMarketPrice(planet, resource)` returning the neutral market
      price (no faction buy/sell mult, no rank discount) so scanning needs no `Player`
- [x] implement `scanTradeRoutes(galaxy, priceFn, opts)` → ranked `RouteCandidate[]`
      `{ resource, fromSystemId, fromPlanetId, toSystemId, toPlanetId, fromPrice, toPrice,
      marginPct }`, only pairs in different systems, margin = (sell−buy)/buy
- [x] cap to `opts.maxRoutes`, sort by margin desc, deterministic tie-break by ids
- [x] write tests: ranking order, cross-system only, margin math, cap, determinism
- [x] run tests — must pass before next task

### Task 2: Rumor type, NewsEvent variant, and schema
**Files:**
- Modify: src/types/index.ts (`NewsEvent` union += `"TRADE_OPPORTUNITY"`; add optional
  rumor fields: `resource?`, `fromSystemId?`, `toSystemId?`, `marginPct?`)
- Create: src/domain/RouteRumor.ts (`RouteRumor` value type + helpers)
- Modify: src/validation/schemas.ts (mirror new NewsEvent fields + Galaxy rumor store)
- Create: src/tests/trade/routeRumor.test.ts

- [x] define `RouteRumor` (route candidate + `createdDay`, `lastMarginPct`, `id`)
- [x] extend `NewsEvent` union and optional fields; update Zod schema in `schemas.ts`
- [x] add a Russian formatter `describeRumor(rumor, galaxy)` →
      "Везите <товар> из <A> в <B>: маржа ~N%"
- [x] write tests: type round-trips through schema; formatter output
- [x] run tests — must pass before next task

### Task 3: Rumor lifecycle on the daily tick
**Files:**
- Modify: src/domain/Galaxy.ts (store `activeRumors: RouteRumor[]`; getter; persist)
- Create: src/systems/trade/RumorDirector.ts (`updateRumors(galaxy, scanFn, day, cfg)`)
- Modify: src/config/balance.ts (`rumorMarginOpen`, `rumorMarginExpire`, `rumorMaxActive`)
- Modify: src/validation/schemas.ts (Galaxy `activeRumors`)
- Create: src/tests/trade/rumorDirector.test.ts

- [x] `updateRumors`: refresh existing rumors' margins from current prices; expire those
      below `rumorMarginExpire` (emit a "акция закончилась" news); open new rumors above
      `rumorMarginOpen` up to `rumorMaxActive`; emit TRADE_OPPORTUNITY news for new ones
- [x] store/trim active rumors on `Galaxy`; persist via schema
- [x] write tests: open above-threshold, expire when spread closes, cap respected,
      news emitted exactly once per open/close
- [x] run tests — must pass before next task

### Task 4: Hook rumors into GameEngine.advanceGalaxyDay
**Files:**
- Modify: src/systems/GameEngine.ts (call `RumorDirector.updateRumors` once per day,
  AFTER `advanceMarketDay`, feeding scanned routes; keep existing MARKET_SHIFT news)
- Modify: src/tests/globalEvents.test.ts is OFF-LIMITS — add new test file instead
- Create: src/tests/trade/rumorDailyTick.test.ts

- [ ] wire the director into the daily loop; ensure ordering (drift → scan → rumor update)
- [ ] guard for galaxies with <2 market systems (no rumors, no crash)
- [ ] write tests: a day with a seeded spread produces a TRADE_OPPORTUNITY news entry
- [ ] run tests — must pass before next task

### Task 5: NPC traders react to rumors
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts (`pickTraderGoal`: with probability
  `f(marginPct)` choose an active rumor → set destination = rumor.toSystem, cargo =
  rumor.resource bought at rumor.fromSystem; else keep current random behavior)
- Modify: src/config/balance.ts (`rumorNpcBaseChance`, `rumorNpcMarginScale`)
- Create: src/tests/npc/npcRumorReaction.test.ts

- [ ] reaction probability scales with margin and tapers to ~0 as margin → expire threshold
- [ ] only TRADER-role NPCs react; pirates/garrisons unaffected
- [ ] draws use the passed `SeededRNG` (deterministic)
- [ ] write tests: high-margin rumor pulls a measurable fraction of traders; near-expiry
      rumor pulls almost none; non-traders ignore it
- [ ] run tests — must pass before next task

### Task 6: NPC trades move the SAME persistent balance
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts (`simulateTraderTrade`: in addition to the
  existing `supplyVector` shift, call `Market.applyTradeImpact()` — buy at source raises,
  sell at dest lowers — so NPC flow converges the route like the player does)
- Create: src/tests/trade/rumorConvergence.test.ts

- [ ] NPC buy/sell apply persistent `applyTradeImpact` with NPC-scaled magnitude
- [ ] convergence test: seed a route, run player+NPC trading for N days, assert margin
      shrinks below `rumorMarginExpire` and the rumor closes (self-balancing)
- [ ] regression test: same-planet buy→sell still loses credits (SELL_SPREAD intact)
- [ ] run tests — must pass before next task

### Task 7: Surface rumors to the player (news / Info Center)
**Files:**
- Modify: src/presentation/InfoCenterScene.ts (render active TRADE_OPPORTUNITY rumors as a
  "Торговые возможности" section, most-profitable first, with from→to + margin)
- Modify: e2e/ regression spec (rumor row renders)
- Create/Modify: src/tests/presentation/* if a unit-level render test fits

- [ ] list active rumors (sorted by margin) with the Russian formatter; readable contrast
      (reuse the `0xb4b4b4`+ palette, no sub-AA grays)
- [ ] empty-state copy when no active rumors
- [ ] add e2e/regression assertion that a rumor renders
- [ ] screenshot-verify the panel
- [ ] run tests — must pass before next task

### Task 8: Verify acceptance criteria
- [ ] verify Overview behaviours: rumors appear, NPCs react probabilistically, player+NPC
      trading converges routes, rumors expire and NPC flow tapers, balance never runs away
- [ ] run full unit suite (`npm test -- --run`) — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean
- [ ] confirm no existing test assertions were modified

## Technical Details
- **Neutral pricing for scanning:** `referenceMarketPrice` strips faction/rank modifiers so
  rumors reflect the true galaxy spread, not one player's discounts.
- **Reaction curve:** `p = clamp(rumorNpcBaseChance + rumorNpcMarginScale × marginPct, 0,
  pMax)`; with `marginPct → rumorMarginExpire`, `p → ~baseChance` only, so the flow tapers.
- **Convergence:** each NPC/player leg nudges `priceMultipliers` (capped per trade); the
  source rises and the destination falls until `marginPct < rumorMarginExpire`; idle days
  mean-revert toward 1.0 so closed routes relax back and can re-open later.
- **Determinism/persistence:** rumors seeded from `galaxy.id+gameDays`; `activeRumors`
  persisted via `schemas.ts`; NPC draws from the existing `SeededRNG`.

## Post-Completion
**Manual verification:**
- Play a few days: confirm a rumor appears in Info Center, watch its margin shrink as you
  (and NPCs) run it, and confirm it closes with an "акция закончилась" news line.
- Sanity-check that the galaxy-wide average price multiplier stays near 1.0 over a long
  session (no runaway inflation/deflation).
