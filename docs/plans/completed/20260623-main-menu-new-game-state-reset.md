---
# «Новая игра» Fully Resets Game State

## Overview
Starting a new game from the main menu does not reset the prior game to a clean
slate, so the "new" game inherits stale state. Two linked causes:

1. **`MainMenuScene.handleNewGame()` never resets** — it only
   `transitionTo(RACE_SELECTION)`. Since new-game creation in `GameEngine.
   transitionTo` is gated on `!this.player` (`GameEngine.ts:372`), and the player
   from the previous in-session game is still set, **no fresh game is created** —
   the old player, galaxy, credits and quests carry straight through.
2. **`generateDefaultGameState()` is itself incomplete** — it nulls
   `player`/`playerLoadout`, regenerates the galaxy, and clears the win/death
   guards, but leaves the **questManager** (active/completed/pending quests), the
   **banking ledger**, and the **persisted flight position** (`flightShipPos`/
   `lastFlightShipPos`) from the prior game. Even when it runs, residue leaks in.

Goal: «Новая игра» always yields a genuinely fresh game — no quests, default
credits/ledger, null flight position, freshly generated galaxy and a new
character flow — regardless of whether a game was already in progress this session.

## Context (from discovery)
- **Trigger:** `src/presentation/MainMenuScene.ts` `handleNewGame()` (~L456) →
  `transitionTo(SceneType.RACE_SELECTION)` only (no reset).
- **New-game gate:** `src/systems/GameEngine.ts` `transitionTo` (~L372):
  `if (isGameStartScene && !this.player) { …createPlayer… }` — skipped when a
  player already exists.
- **Existing (partial) reset:** `generateDefaultGameState()` (~L1658): nulls
  `player`/`playerLoadout`, `_gameOverShown`/`_winScreenShown`/`_playerDeathShown`,
  `playerService.deletePlayer()`, regenerates galaxy. **Does NOT** clear quests,
  banking, or `flightShipPos`/`lastFlightShipPos` (fields ~L108/L124).
- **Proper-restart precedent:** `restartNewGame()` (~L1446) = `generateDefault
  GameState()` + `transitionTo(RACE_SELECTION)` — the death/restart path; reuse it.
- **Subsystems to clear:** `questManager` (IQuestService — needs a clear/reset of
  active/completed/pending), the banking service/ledger (`this.bank` — CLAUDE.md
  notes load does a `resetLedger()` + re-seed), transient flight position.
- **Lockstep note:** this is runtime state reset only — no `src/types`/domain/
  schema change, so `schemas.ts` is untouched.

## Development Approach
- **Testing approach: TDD** — write the failing regression first (a second
  «Новая игра» after an in-progress game leaves stale player/quests/ledger/flight
  position), then fix until green. Project regression-first rule.
- **Reuse, don't fork:** centralize the full reset in `generateDefaultGameState`
  (or a clearly named `resetForNewGame`) and have both `restartNewGame` and the
  menu path call it — one reset, two callers, no divergence.
- **Do NOT weaken existing tests.** Run `gitnexus impact` on
  `generateDefaultGameState`, `restartNewGame`, and `handleNewGame` first
  (GameEngine is central — warn on HIGH/CRITICAL). Keep the change additive.
- Complete each task (code + tests green) before the next; full suite + lint at end.

## Implementation Steps

### Task 1: Make the reset complete (quests, banking, flight position)
**Files:**
- Modify: `src/systems/GameEngine.ts` (`generateDefaultGameState`)
- Modify: quest/bank service if a public clear/reset is missing
- Create: `src/tests/core/GameEngine.new-game-reset.test.ts`

- [ ] `gitnexus impact` on `generateDefaultGameState`; confirm callers
      (`restartNewGame` + the new menu caller) and blast radius.
- [ ] Extend `generateDefaultGameState` to also clear: the **questManager**
      (active/completed/pending — add a `reset()`/`clear()` on the service if none
      exists), the **banking ledger** (`this.bank` service `resetLedger()` + re-seed
      from default credits, matching the load path), and **`flightShipPos` /
      `lastFlightShipPos`** (null both). Keep the existing player/loadout/galaxy/
      guard resets.
- [ ] write tests: after seeding an in-progress game (player + a quest + a credit
      move + a flight position), `generateDefaultGameState()` leaves **no active/
      completed/pending quests, default ledger/credits, null flight position, null
      player/loadout, and a freshly-seeded galaxy**. (Fails today — quests/banking/
      position survive.)
- [ ] run touched tests — green.

### Task 2: «Новая игра» runs the full reset before character creation
**Files:**
- Modify: `src/presentation/MainMenuScene.ts` (`handleNewGame`)
- Modify: `src/systems/GameEngine.ts` (expose the reset path if needed)
- Create/Modify tests under `src/tests/`

- [ ] Route `handleNewGame()` through the full reset — call
      `gameEngine.restartNewGame()` (reset + RACE_SELECTION) instead of a bare
      `transitionTo(RACE_SELECTION)`, so the `!this.player` gate sees a null player
      and a fresh game is created downstream.
- [ ] write a regression test: with a player already set (mid-session), invoking
      the new-game path nulls the player and routes to RACE_SELECTION, and the
      subsequent START scene creates a brand-new player/galaxy (no carryover).
      (Fails today — the old player persists and short-circuits new-game creation.)
- [ ] run touched tests — green.

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only the reset path
      + menu wiring affected.
- [ ] full unit suite `npm test -- --run` green (incl. untouched assertions);
      `npm run lint` clean; `npm run build` succeeds.

### Task 4: Update documentation
**Files:**
- Modify: `CLAUDE.md` save/reset note if it describes new-game state lifecycle.

- [ ] Document that `generateDefaultGameState` is the single full-reset point
      (player + loadout + galaxy + guards + quests + ledger + flight position) and
      that both restart-on-death and menu «Новая игра» go through it.

## Technical Details
- Runtime-state reset only — no schema/migration change.
- Banking reset mirrors the load path: `resetLedger()` then re-seed the player
  current account from default credits (keeps the projection valid).

## Post-Completion
**Manual verification:**
- Play a bit (accept a quest, earn/spend credits, move the ship), return to the
  main menu, pick «Новая игра» → confirm the new game starts with no quests,
  default credits, a fresh galaxy/position, and the character-creation flow.
- «Продолжить» still resumes the autosave (unaffected by the new-game reset).

*Deferred (separate plan): planet-backdrop + sun art variety and new WebP asset
generation. Design references live in `docs/design/ART_PROMPTS.md` and
`docs/design/ASSET_PIPELINE.md`.*
