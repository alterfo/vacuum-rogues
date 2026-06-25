---
# Save-Compatibility Safety Net (Don't Break Beta-Testers' Progress)

## Overview
Beta-testers have **real, progressed saves** (piles of credits, far progress). The wave
of balance/schema changes coming (economy, combat, endgame…) must **never** break them:
an old save must still **load → migrate → stay playable**. Add a safety net: a corpus of
**golden saves** loaded against current code in CI, a **load-time loadout revalidation**
so catalog changes can't leave a save in an invalid state, and a **deploy gate** that
fails if a change would brick old saves.

## Context (from discovery)
- **Migration exists:** `MigrationPipeline.CURRENT_VERSION = 27`, step-wise `v→v+1`
  migrations; schema in `src/validation/schemas.ts`. Lockstep rule (CLAUDE.md): a
  persisted field change ⇒ schema + migration + version bump.
- **Galaxy is persisted** (`SaveStateSchema.galaxy` → `systems[].starType`) — so
  generation changes (star types) affect **new games only**; existing saves are safe.
- **The risk path:** catalog/`GearCatalog` changes are runtime-applied (no migration),
  but a hull whose **slots/mass capacity shrinks** can leave a progressed save's loadout
  **over-capacity** — `ShipLoadout.setHull` already drops non-fitting gear *on a hull
  swap*, but a load that just restores a persisted loadout may not re-run that check.
- **Tests today:** `hullUnificationMigration.test.ts` + scattered migration tests, but
  **no golden-save corpus** and **no across-versions load-and-play gate**.

## Development Approach
- **Testing approach: TDD.** The load-time revalidation (over-capacity → drop to bag) is
  pure and unit-tested. Golden saves are fixtures; the load-test asserts each
  loads→migrates→validates with no crash and sane state. `impact` on the load path
  (`GameEngine.loadGame` / `validateSaveState` / `ShipLoadout` restore) first.
- Additive safety; no new persisted field (the revalidation is corrective, not a schema
  change). The letsplay agent can then *play* a migrated golden save to prove it's
  playable, not just loadable.

## Implementation Steps

### Task 1: Golden-saves corpus + load→migrate→playable test
**Files:**
- Create: `src/tests/data/goldenSaves/*.json` (early / mid-with-savings / late-progressed, recent versions)
- Create: `src/tests/data/goldenSaveCompat.test.ts`

- [ ] Capture a small corpus of representative saves (incl. a high-credit, late-progress
      one) — generated from the real engine + a couple of hand-pinned older-version saves.
- [ ] Test: each golden save **loads**, **migrates to `CURRENT_VERSION`**, passes
      `validateSaveState`, and yields a resumable scene + intact credits/galaxy — no
      thrown/logged error.
- [ ] run tests — green.

### Task 2: Load-time loadout revalidation (catalog changes can't brick a save)
**Files:**
- Modify: `GameEngine.loadGame` / `ShipLoadout` restore path
- Create: `src/tests/core/loadoutRevalidateOnLoad.test.ts`

- [ ] On load, revalidate the restored loadout against the **current** hull spec; if it
      exceeds slots/mass capacity (because a catalog change shrank the hull), **drop the
      excess gear to the inventory bag** (reuse the `setHull` drop semantics) instead of
      loading an invalid state.
- [ ] write tests: a save whose loadout over-fills a now-smaller hull loads cleanly with
      the excess moved to the bag; a normal save is untouched.
- [ ] run tests — green.

### Task 3: Deploy gate + golden-save playtest
**Files:**
- Modify: `lefthook.yml` / CI workflow, `package.json`

- [ ] Add the golden-save load-test (and optionally a short letsplay run that *plays* a
      migrated golden save) to the pre-push/CI gate, so a save-breaking change fails CI.
- [ ] document how to add a golden save when a new persisted feature ships.

### Task 4: Verify + docs
**Files:**
- Modify: `CLAUDE.md` (persistence section)

- [ ] `detect_changes`; full suite + `test:playtest` green; lint/build ok.
- [ ] Document the save-compat contract: persisted change ⇒ migration + a golden save;
      catalog change ⇒ load revalidation; generation change ⇒ new-games-only; the gate.

## Technical Details
- The galaxy/most state is already persisted, so generation/balance changes are
  inherently new-game-only or runtime-applied. The two real hazards are **(a)** an
  un-migrated persisted-field change and **(b)** a catalog shrink leaving a loadout
  invalid — Task 1 catches (a), Task 2 fixes (b). No new save field.

## Post-Completion
**Manual:** take a real beta-style save (lots of credits, late progress), deploy the
balance batch, load it — opens, keeps its credits/progress, any now-oversized loadout
gracefully trimmed, fully playable.
