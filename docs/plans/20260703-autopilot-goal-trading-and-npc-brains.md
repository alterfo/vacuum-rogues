# Autopilot goal-directed trading + player UX + NPC brains

## Overview

A 100-session headless diagnostic (2026-07-03, `MemoryHeuristicPolicy` = the live
dev-autopilot brain) found the autopilot **safe but inert**: after the combat +
Overmind fixes already landed on this branch it no longer dies or bankrupts
itself, but it **completes 0 quests and 89% of sessions make no profit** — it
"just flies and does nothing toward the goal" (the user's words).

**Already fixed on this branch (green, do NOT redo):**
- **Combat fight-or-flee by relative strength** (`MemoryHeuristicPolicy.ts`
  survive block): flee when a hostile's `hullHP` exceeds the player's current
  hull (`flee-outmatched`), not just at `hurt<35%`. Deaths **13%→0%**,
  low-hull-stall **13%→0%**, heavy-damage **12%→0%**.
- **Overmind loss threshold 0.5→0.85** (`balance.ts` `OVERMIND_SPREAD_LOSS_SHARE`):
  the galaxy is only "lost" at ~85% captured, not 50% (seeing half the galaxy
  free while told "you lost" read as a bug). `overmindArc.test.ts` loss-window
  widened to match. Galaxy-fell(≥50% share) dropped **50%→10%** (also helped by
  the faster agent: avg game-days/session **26→11**).

**Root cause of the remaining inertness (the credit drain, now reverted):**
`executeMemoryAwareTrade` (`engineQueries.ts`) blind-buys the cheapest good with
the **whole wallet** when no known margin exists; the agent then wanders holding
unsellable cargo (−950 avg drain). Removing the speculation stopped the drain
(−950→−175) but left the agent with **no way to bootstrap a profitable trade** —
it rarely discovers a cross-planet margin within a session, so `competentSession`
+ `liveEconomyHeads` went red. The revert restored green; this plan rebuilds
trading the *right* way: deliberate price discovery → known-margin buy-low → sell.

**Goal:** make the autopilot actually *achieve* things — complete profitable
buy→sell cycles and quests — without the destructive full-wallet speculation, and
land the player-facing UX the user asked for. Then (Phase 2) reuse the same brain
for NPCs with distinct goals.

## Context (from discovery)

- **Shared brain:** `src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts` —
  `decideWithMemory(obs, mem, goal?)`, priority-list ladder, `wait` floor. Base
  SPACE_FLIGHT/PLANET sequencing is where trading decisions live.
- **Two appliers:** live `installAutopilotHook.ts` + `AutopilotController.ts` +
  `LiveApplier.ts`; headless `PlayerAgent.ts`. The trade executor
  `executeMemoryAwareTrade`/`executeTradeOnPlanet` (`engineQueries.ts`) is shared
  by BOTH (live via `installAutopilotHook.ts:288`), so a fix there fixes both.
- **Trade tests that lock current behavior** (user has authorized editing these
  to fit the corrected design — see memory `project-autopilot-rework-2026-07`):
  `trade.test.ts` (asserts the null-path blind-buys cheapest),
  `competentSession.test.ts` (asserts ≥1 `sell-for-profit` cycle on seed
  `LETSPLAY_HOLISTIC3`), `liveEconomyHeads.test.ts` (buy-price recorded after a
  speculative buy), `neuralSession.test.ts` (net picks ≥3 distinct actions).
- **Diagnostic harness (MEASUREMENT GATE):**
  `src/tests/playtest/letsplay/_autopilotDiag.run.test.ts` — inert unless
  `DIAG_SESSIONS` is set (`it.runIf`). Run:
  `DIAG_SESSIONS=100 DIAG_STEPS=60 npx vitest --run …_autopilotDiag.run.test.ts`.
  It prints: died / galaxy-fell / low-hull-stall / wandering / no-credit-gain /
  0-quests / avg-credits-delta / avg-quests / end-scene histogram. **This file is
  a scratch tool — delete it (and remove its MEMORY pointer) at the end of the
  final task.**
- **Price discovery is free on landing:** `observe`+`updateMemory` fold a
  planet's market into `mem.priceBook` before the decision — a buy is NOT needed
  to learn prices. Cross-planet margins need ≥2 markets visited.

## Success criteria

- Autopilot 100-run: **≥60% of sessions net-positive credits**, **avg ≥1 quest
  completed**, **0% deaths**, **galaxy-fell ≤10%**, **0 harness errors**. Record
  the before/after table in the final task from the diagnostic.
- No full-wallet speculation: a session never drains >X% of credits into cargo
  with no known sell destination.
- `competentSession`, `liveEconomyHeads`, `neuralSession`, `trade.test.ts` all
  green under the new design (edit assertions where the *intended* behavior
  changed; never weaken to hide a real regression).
- `npm run test:playtest`, `npm run letsplay:ci`, `npm run test:save-compat`, lint,
  tsc all green. Combat + Overmind wins preserved.

## What Goes Where (legend)

- Policy ladder / decisions → `MemoryHeuristicPolicy.ts`
- Trade/quest executors → `engineQueries.ts`, `equipmentQueries.ts`
- Live-only wiring → `installAutopilotHook.ts`, `LiveApplier.ts`
- Player UI/UX → `src/presentation/` (+ `src/i18n/` RU/EN)
- Balance constants → `src/config/balance.ts`

---

## Phase 1 — Autopilot achieves goals

### Task 1: Deliberate price discovery + no-speculation trading
- [x] Replace the full-wallet blind-buy in `executeMemoryAwareTrade` with: buy
      ONLY a known-profitable `preferredGood`, capped to a credit-reserve
      fraction; with no known margin, sell-only (no speculation). Keep
      `executeTradeOnPlanet` as the thin wrapper (shared by live).
- [x] Add a price-discovery tier to the ladder: with an empty hold and no known
      margin, prefer landing on an **unvisited in-system planet** (populate the
      price book) over blind explore-warp; gate `inspect-market` so it can't
      ping-pong PLANET↔TRADE once this planet's prices are known.
- [x] Ensure the buy-low→go-sell→sell-for-profit loop actually fires: once a
      cross-planet margin is known, buy-low at the cheap planet and route to the
      sell planet.
- [x] Update the locked trade/competentSession/liveEconomyHeads assertions to the
      corrected behavior (authorized). Prove `sell-for-profit` fires legitimately
      on the competentSession seed.
- [x] Gate: `MemoryHeuristicPolicy.test.ts`, `trade.test.ts`, `competentSession`,
      `liveEconomyHeads`, `letsplay:ci`, `test:playtest`. Diagnostic 100-run shows
      ≥60% net-positive.

  **Landed 2026-07-03.** Beyond the two checkbox items, root-causing the
  diagnostic surfaced three more bugs that had to be fixed for the loop to
  actually work instead of stalling:
  - `bestKnownMargin` is scored over the WHOLE session's price book, not just
    the current system — a stale margin from a system left behind (or one
    that's since gone unaffordable) read as "actionable" and permanently
    blocked the price-discovery/early-explore tiers. Fixed via
    `bestBuyIsLocal`/`bestBuyAffordable` gating `go-buy`/`noActionableMargin`.
  - `land`/`trade` never simulate flight time (only `move`/warp advance the
    galaxy calendar), so a good local buy-low/sell-for-profit pair could be
    farmed forever without a single day passing. Added
    `AgentMemory.foldsSinceDayAdvance` + `MAX_FOLDS_WITHOUT_DAY_ADVANCE`: once
    tripped, the ladder stops starting new buy cycles and forces
    early-explore, letting existing cargo drain out first.
  - `PlayerAgent`'s trade executor call always passed
    `bestKnownMargin(this.memory).good` as the preferred buy good, even when
    landed at the SELL planet — so a `sell-for-profit` there would immediately
    buy the same good right back if it happened to be stocked, re-creating
    cargo and stalling the sell-off for many rounds. Fixed to only pass the
    preferred good when landed at that margin's actual buy planet.

  100-run diagnostic (`DIAG_SESSIONS=100 DIAG_STEPS=60`): 0% died, 60%
  net-positive credits (≥60% target met), avg credits Δ=+121, 0% harness
  errors. Quests are still 0% (Task 2) and the Overmind "≥50% share" proxy
  bucket rose from the already-fixed baseline's 10%→44% (avg game-days
  22.3 vs ~11) — expected fallout of the agent now traveling/warping much
  more; the real loss threshold is 0.85 share, not this bucket's 50%, and
  Task 7/8 revisit Overmind pacing against the true threshold.

### Task 2: Quests — take and deliver
- [ ] Make the agent take offered work when landed and route to complete
      deliverable quests (the delivery-completion seam already exists in
      `PlanetScene.checkDeliveryQuestCompletion`). Rank quest completion sensibly
      against the trade loop.
- [ ] Gate: diagnostic 100-run shows **avg ≥1 quest completed**; playtest green.

### Task 3: Fuel — never idle on the star map
- [ ] Fix the live-observed bug: with no fuel on STAR_MAP the autopilot idles
      instead of returning to flight and landing to refuel. Reproduce (live path
      / `LiveApplier`), add a regression, fix so a fuel-critical agent always
      routes to a refuel landing (or is provably stranded only when truly no
      habitable planet + no fuel exists).
- [ ] Gate: regression + diagnostic (add a fuel-stranded counter) at 0%.

## Phase 2 — Player UX

### Task 4: Auto-refuel hint
- [ ] Tell the player that landing on a planet / docking at a station refuels for
      free (contextual hint / onboarding tip), RU+EN via `src/i18n/`.

### Task 5: Incoming-attacker indicator
- [ ] Show the player which ships are approaching to attack (threat markers /
      list in flight), so an incoming hostile isn't a surprise.

## Phase 3 — NPC brains (user-sequenced AFTER the autopilot is good)

### Task 6: Reuse the policy brain for NPCs with distinct goals
- [ ] Give NPCs goal-directed behavior derived from the same decision core, with
      per-NPC goals (trader, pirate, patrol, etc.) instead of aimless drifting.
- [ ] Fix NPCs flying into the sun (respect the star contact-damage radius, same
      SAFE-ring logic the agent's `flyForward` uses).

### Task 7: Overmind spawn distribution
- [ ] Address "Overmind appears from all sides" — review spawn/spread so the
      front reads as a coherent advancing frontier, not simultaneous
      all-directions pop-in. Config in `balance.ts` + `overmindSpread.ts`.

### Task 8: Final gate + cleanup
- [ ] Full suite, lint, tsc, playtest, letsplay:ci, save-compat green.
- [ ] Record the before/after diagnostic table; **delete
      `_autopilotDiag.run.test.ts`** and its MEMORY.md pointer.

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`.*
