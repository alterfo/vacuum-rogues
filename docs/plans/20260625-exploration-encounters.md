---
# Exploration Encounters (Derelicts, Anomalies, Distress Calls)

## Overview
Add depth to flying around: **random in-system encounters** — derelict ships to salvage
(risk/reward, sometimes a trap), spatial **anomalies** (scan for bonuses/hazards), and
**distress calls** (rescue → reward, or ambush). These make exploration meaningful
between trade/quest loops and feed the living-galaxy feel, reusing the existing combat +
loot + reward seams.

## Context (from discovery)
- **NPC + combat seams exist:** `NpcShipManager` spawns/handles in-flight ships +
  loot drops (`spawnLootForNpc`); `CombatModule` resolves fights — ambush encounters
  reuse these.
- **Rewards/economy seams:** banking `adjustPlayerCredits`, cargo, reputation
  (`Player.adjustReputation`) — encounter payoffs route through these.
- **Daily/flight ticks:** `advanceGalaxyDay` (seeding) + the flight update loop (spawn
  on entry) are the cadence hooks.
- **Scenes:** a lightweight encounter prompt can reuse the NPC contact panel / a small
  modal rather than a new heavy scene.

## Development Approach
- **Testing approach: TDD.** A pure **encounter generator** (system + seed + player state
  → an encounter or none, with weighted types + scaling) and the pure **outcome resolver**
  (choice → reward/penalty/combat) are unit-tested; wiring verified in the real-engine
  playtest. Reuse loot/combat/reward seams — no new economy plumbing.
- Encounter *occurrence* is deterministic by seed (testable); persisted "cleared
  encounters" (if any) follow the schema+migration lockstep, else keep them ephemeral
  (no save change — prefer this).

## Implementation Steps

### Task 1: Encounter generator (pure)
**Files:**
- Create: `src/systems/encounters/encounterGenerator.ts` (+ test)

- [x] `rollEncounter(system, seed, playerState)` → `Encounter | null` (derelict / anomaly
      / distress), weighted + scaled to danger/rep; deterministic by seed; rate-limited so
      it's a spice, not a flood.
- [x] write tests: weighting + scaling, rate limit, deterministic by seed.
- [x] run tests — green.

### Task 2: Outcome resolver (pure)
**Files:**
- Create: `src/systems/encounters/encounterOutcome.ts` (+ test)

- [x] `resolve(encounter, choice, rng)` → `{credits?, cargo?, repΔ?, startCombat?, message}`
      (salvage success/trap, anomaly bonus/hazard, rescue/ambush).
- [x] write tests: each branch yields the right payoff; trap/ambush triggers combat.
- [x] run tests — green.

### Task 3: Wire into flight (prompt + payoff)
**Files:**
- Modify: `SpaceFlightScene`/`NpcShipManager`; a small encounter prompt (reuse contact panel)

- [x] On system entry/flight tick, `rollEncounter`; present a small choice prompt; apply
      `resolve` via banking/cargo/rep seams; route `startCombat` through `CombatModule`.
- [x] write tests (real-engine playtest): an encounter fires, a choice applies the payoff,
      an ambush starts a fight; zero logged errors.
- [x] run tests — green.

### Task 4: Verify + balance + docs
- [ ] full suite + `test:playtest` green; lint/build ok; tune rates/payoffs in `balance.ts`;
      document the encounter generator + outcome seams.

## Post-Completion
**Manual:** fly around — derelicts/anomalies/distress calls appear at a tasteful rate; choices
have real risk/reward; ambushes flow into normal combat.
