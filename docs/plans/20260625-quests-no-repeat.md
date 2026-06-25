---
# Quests Should Not Repeat

## Overview
The job/quest board re-offers the **same quests** the player has already seen,
taken, or completed, which feels broken ("задания не должны повторяться"). Make
quest generation **deduplicate** against what the player has already engaged with:
a quest that's currently **active**, already **completed**, or **already shown on
the current board** should not be generated again as a fresh offer.

## Context (from discovery)
- **Generation:** `src/systems/quests/QuestGenerator.ts` `generateQuestBoard(opts)`
  (~L219). It already takes `completedQuestChains` and skips chain parts when a
  chain is completed (~L307/L326) — but that's **chain-level only**; one-off
  generated quests are not deduped, so the board can re-roll the same offer.
- **Quest identity:** `GeneratedQuest` carries `targetSystemId` / `targetPlanetId`
  / objectives and a chain id — enough to form a stable **dedupe key** (and chains
  already have `chainId`). Need a key that identifies "the same quest" across
  re-generation (kind + target + payload, or a generated quest id).
- **What the player has engaged:** the active quest log + the completed set live in
  `QuestManager` (`restoreState`, active/completed lists). The board generator must
  receive these as exclusions (the same way `completedQuestChains` is threaded in).

## Development Approach
- **Testing approach: TDD.** `generateQuestBoard` is pure given its options —
  add exclusion inputs (active keys, completed keys, already-on-board keys) and a
  stable `questKey(quest)`; assert no excluded key is emitted and the board still
  fills to size from the remaining pool. Determinism (seeded) must be preserved.
- Additive to the generator signature + the call site that threads
  active/completed quests in. No domain/schema change *unless* a persisted
  "offered/seen" set is required (see Task 1 — prefer deriving exclusions from the
  already-persisted active+completed sets to avoid a save migration).

## Testing Strategy
- **Unit:** `questKey` is stable for "the same quest" and distinct across different
  targets/kinds; `generateQuestBoard` never emits a quest whose key is in
  active/completed/on-board exclusions; the board still reaches its target size
  from the remaining pool; seeded output stays deterministic.
- **Real-engine playtest:** taking a quest then re-opening the board does not show
  that quest again; completing a quest does not let it reappear.

## Implementation Steps

### Task 1: Confirm the repeat path + define a stable quest key (investigation)
**Files:**
- Create: `src/tests/quests/questNoRepeat.characterize.test.ts`

- [ ] Reproduce the repeat as a red test: generate a board, mark one quest
      active/completed, regenerate, and show the same quest re-appears today.
- [ ] Define `questKey(quest)` (kind + target system/planet + distinguishing
      payload, or a generated stable id) and decide the exclusion source — prefer
      deriving from the already-persisted **active + completed** quest sets (no new
      persisted field / no save migration) over a new "seen" store.
- [ ] run — the characterization test is RED (repeat reproduced).

### Task 2: Dedupe generation against active/completed/on-board
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: the board call site (threads active + completed quests in)
- Modify: `src/tests/questScripts.test.ts` / quest generator tests as needed

- [ ] Extend `generateQuestBoard` options with exclusion key sets (active,
      completed) and skip any candidate whose `questKey` is excluded or already
      placed on the board being built; keep filling to size from the remaining pool.
- [ ] Thread the player's active + completed quests into the call site (mirror the
      existing `completedQuestChains` wiring).
- [ ] write tests: excluded keys never emitted; board still fills; deterministic
      under a fixed seed; the Task 1 characterization now passes (no repeat).
- [ ] run tests — green.

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only the generator
      + its call site + tests affected; **confirm no schema/migration change** (or,
      if a persisted "seen" set was unavoidable, that `schemas.ts` +
      `MigrationPipeline.ts` + `CURRENT_VERSION` are updated — see CLAUDE.md).
- [ ] full unit suite green (the locked quest tests stay green); `npm run
      test:playtest` green; lint clean; build ok.

### Task 4: Update documentation
**Files:**
- Modify: `docs/` quest-system note

- [ ] Note the board dedupe: `questKey` + exclusion of active/completed/on-board
      quests, derived from existing persisted state.

## Technical Details
- Prefer deriving exclusions from the already-persisted active+completed quest
  sets so no new save field is needed. If an "offered/seen" set proves necessary,
  it is a persisted domain field → it requires the full lockstep (schema +
  migration + version bump) per CLAUDE.md.

## Post-Completion
**Manual verification:** open the job board, take/complete a few quests, reopen —
no quest the player has taken or completed reappears as a fresh offer.
