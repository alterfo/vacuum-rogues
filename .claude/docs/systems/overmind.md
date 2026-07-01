# Overmind Endgame Arc

The OVERMIND is an escalating, spreading endgame arc: it captures systems over time culminating in win (break the core), loss (galaxy consumed), or New Game+.

## The spread machine

`advanceOvermind(state, galaxy, day, config)` (`src/systems/overmind/overmindSpread.ts`) is deterministic by `(galaxy.id, day, systemId)` (ranked by `hashStr`, no RNG): past `graceDays` it captures `capturesPerTick` **frontier** systems every `spreadIntervalDays`, then re-derives `dormant → advancing ⇄ contained → won|lost` from the post-capture Overmind share. Returns `captured` ids for the caller — never mutates the galaxy. Tuning: `balance.ts` (`OVERMIND_SPREAD_*`).

## Critical invariants — do NOT revert these

- **`frontierSystems` treats the warp graph as UNDIRECTED.** ~25% of galaxy warp links are one-way (`ensureConnectivity` bridges), so a directed-only scan misses systems reachable via one-way outgoing edges — stalls the front for days.
- **Win requires GENUINE ENGAGEMENT**: `coreBroken`/`eradicated` are gated on `engaged = state.lastSpreadDay >= 0` (arc actually spread past grace). `peakThreat` is a *false* proxy: it captures the initial Overmind share (e.g. 2/30 ≈ 0.067) during the grace window — without the gate, early clearance of starting systems fired spurious ПОБЕДА. The in-flight **core-kill** win is a separate path (`handleInFlightDeath` → `showGameOutcomeScreen(true)`) and is unaffected.
- **The arc OWNS the front; equilibrium only churns pirates.** `GameEngine` passes `stepOwnershipTick` a `freezeOvermind: true` when Overmind holds territory, so the equilibrium's ~25% ceiling can't cap the arc below its loss line or liberate the core spuriously.

Regressions: `overmindNoSpuriousVictory.test.ts`, `overmindSpread.test.ts`, `playtest/overmindArc.test.ts`.

## Persistence

`Galaxy.overmindArc: OvermindSpreadState` persists via `GalaxySchema` (migration defaults old saves to `initialOvermindSpreadState()`).

## Win/loss/NG+

Won/lost drives `showGameOutcomeScreen` (overlay over current scene, gated on `_outcomeShown` — not a terminal-scene transition). New-Game+ (`newGamePlus.ts`): capped credit slice + carried rank/faction + one-notch-harder difficulty (`nextCycleGameMode`: GOD→NORMAL→HARD→HARD). Tune carry in `balance.ts` (`NEW_GAME_PLUS_*`).
