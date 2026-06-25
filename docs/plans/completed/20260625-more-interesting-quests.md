---
# More & More Interesting Quests (New Branching Text-Quest Scripts)

## Overview
The player wants **more quests, and more interesting ones**. The "interesting" quests
are the hand-authored **branching text-quests** (`QuestScript` run by `QuestVM`) —
there are only **6** today (auction, customs, investigation, reactor, gravity-slalom,
cargo-sort). This plan roughly **doubles** that catalogue with **6 new branching
scripts** across fresh themes (salvage mystery, smuggling run, hostage rescue,
sabotage/heist, first-contact diplomacy, medical/plague crisis), each with real
**choices, branches, success/failure outcomes and rewards** — plus a light pass to
widen the **procedural** quest flavor (issuer titles / templates) so the routine
board reads less samey.

(De-duplication — "once completed, gone from the board" — is **already covered** by
the queued `docs/plans/20260625-quests-no-repeat.md`; this plan only adds content and
must keep each new script **dedup-friendly**: a stable, unique `id`.)

## Context (from discovery)
- **Script shape:** `src/systems/quests/QuestScript.ts` (`QuestScript` interface:
  `id`, `title`, stages/steps with choices + branch transitions + rewards). Example:
  `src/systems/quests/scripts/investigation.ts` (`investigationScript` — staged,
  branching, id `"investigation"`).
- **Runner:** `src/systems/quests/QuestVM.ts` executes a `QuestScript` (stage/choice
  transitions). Tested in `src/tests/questScripts.test.ts`.
- **Registry (single wire-in point):** `src/systems/quests/TextQuestRegistry.ts` —
  `ALL_QUEST_SCRIPTS: readonly QuestScript[]` (+ `REGISTRY` map, `getQuestScript(id)`,
  `getAvailableQuestScriptIds(planetId)`). A new script is live once added here.
- **Generation:** `QuestGenerator.ts` exposes `TEXT_ADVENTURE` quests (issuer titles
  L188, weight 1.4 L481, `textQuestStub` backed by a `QuestScript` ~L934-959), and
  procedural `ROUTINE_TYPES` = DELIVERY/BOUNTY/ESCORT/DIPLOMACY/EXPLORATION with
  `ISSUER_TITLES` flavor (L181-188).
- **Locked tests:** `questScripts.test.ts` + the quest-completion suites are
  known-good — extend, never weaken (each new script gets its OWN test).

## Development Approach
- **Testing approach: TDD.** For each new script, first write a `QuestVM` test that
  drives its branches (each choice path reaches a terminal stage; success/failure
  rewards apply; no dead ends / unreachable stages), then author the script until
  green. Mirror `questScripts.test.ts` conventions.
- Purely **additive content** + registry entries; no domain/schema/save migration
  (scripts are catalog data; quest *progress* persistence is unchanged). Keep ids
  unique + stable (dedup-friendly). Russian player-facing copy (per project norm),
  English code/comments.
- `impact` on `TextQuestRegistry`/`QuestVM` before editing the registry.

## Testing Strategy
- **Unit:** per script — every choice branch reaches a terminal outcome, rewards/
  reputation deltas fire on the right branch, no unreachable/dead stages, id is
  unique in `ALL_QUEST_SCRIPTS`. A registry test asserts all ids are unique and every
  script loads via `getQuestScript`.
- **Real-engine playtest:** the job board can surface the new scripts; starting one
  drives the `TextQuestScene`/`QuestVM` without thrown/logged errors.

## Implementation Steps

### Task 1: New scripts — salvage mystery, smuggling run, hostage rescue
**Files:**
- Create: `src/systems/quests/scripts/derelict-salvage.ts`, `smuggling-run.ts`, `hostage-rescue.ts`
- Modify: `src/systems/quests/TextQuestRegistry.ts`
- Create/extend: `src/tests/quests/newQuestScripts.test.ts`

- [x] Author 3 branching `QuestScript`s with distinct themes, each with ≥2
      meaningful choice points and ≥2 outcomes (reward/penalty/reputation), stable
      unique ids. (`derelict-salvage`, `smuggling-run`, `hostage-rescue`)
- [x] Register all 3 in `ALL_QUEST_SCRIPTS`.
- [x] write `QuestVM` tests per script: every branch reaches a terminal stage;
      rewards/rep apply on the correct branch; no unreachable stages; id unique.
      (`src/tests/quests/newQuestScripts.test.ts`, 47 tests)
- [x] run tests — green (existing `questScripts.test.ts` stays green: 147 total).

### Task 2: New scripts — sabotage/heist, first-contact, medical crisis
**Files:**
- Create: `src/systems/quests/scripts/sabotage-heist.ts`, `first-contact.ts`, `plague-crisis.ts`
- Modify: `src/systems/quests/TextQuestRegistry.ts`
- Extend: `src/tests/quests/newQuestScripts.test.ts`

- [x] Author 3 more branching scripts (heist with a betrayal branch; first-contact
      diplomacy with peace/hostility outcomes; medical/plague time-pressure choice),
      stable unique ids. (`sabotage-heist`, `first-contact`, `plague-crisis`)
- [x] Register all 3 in `ALL_QUEST_SCRIPTS`. (now 12 scripts)
- [x] write `QuestVM` tests per script (branches terminal, rewards correct, no dead
      ends, ids unique); add a registry test asserting all ids in `ALL_QUEST_SCRIPTS`
      are unique and resolve via `getQuestScript`. (`newQuestScripts.test.ts`, 95 tests)
- [x] run tests — green (newQuestScripts 95 + questScripts 100 = 195 passing).

### Task 3: Widen procedural quest flavor
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`

- [x] Add more `ISSUER_TITLES` + objective/flavor-text variety for the procedural
      `ROUTINE_TYPES` (DELIVERY/BOUNTY/ESCORT/DIPLOMACY/EXPLORATION) so repeated
      routine quests read distinctly (no logic change to targets/economics).
      (titles widened per type; +4 templates each for delivery/bounty/escort/
      diplomacy/exploration; wider issuer-name/convoy/gang pools — RNG draw count
      unchanged so boards stay deterministic.)
- [x] write/extend a generator test asserting the added flavor is reachable and the
      board still generates deterministically under a fixed seed.
      (`src/tests/quests/questGeneratorFlavor.test.ts`, 4 tests)
- [x] run tests — green. (questGeneratorFlavor 4 + full quest suite 305 + journeys
      8; lint clean.)

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — only the new scripts +
      `TextQuestRegistry` + `QuestGenerator` flavor (+ tests) affected; no schema/
      migration. (Verified via `git diff 4c019d0..HEAD`: only `QuestGenerator.ts`,
      `TextQuestRegistry.ts`, the 6 new `scripts/*.ts`, 2 test files + the plan doc —
      no `schemas.ts`/`MigrationPipeline.ts`. gitnexus compare-to-master was too noisy
      to use directly since this branch is far ahead of master with unrelated work.)
- [x] `ALL_QUEST_SCRIPTS` now has 12 scripts, all ids unique (count=12, unique=12);
      `npm run test:playtest` green (67 passed); lint clean (0 errors); build ok.
      Full unit suite 3012 passed — the lone red (`chaseSteering.steering.test.ts`,
      240.75 vs ≤240) is a deterministic, **pre-existing** flight-steering failure
      (last touched by aa5b183/7571454, both predate this plan) unrelated to the quest
      content; this plan touches no flight code, so it neither introduced nor affects it.

### Task 5: Update documentation
**Files:**
- Modify: `docs/` quest-system note (or a scripts README)

- [x] List the new scripts + the "add a branching quest = new `scripts/<id>.ts` +
      register in `ALL_QUEST_SCRIPTS` + a `QuestVM` branch test" recipe.
      (`src/systems/quests/scripts/README.md`: catalogue table of all 12 scripts +
      the 3-step add-a-quest recipe, co-located with the scripts.)

## Technical Details
- Scripts are catalog data consumed by `QuestVM`; adding them needs no save
  migration. Keep ids unique + stable so the no-repeat dedupe (the sibling plan) can
  key on them. Player copy Russian; code/comments English.

## Post-Completion
**Manual verification:** the job board surfaces a wider, more varied set; the new
text-quests play through their branches with sensible outcomes; completed ones drop
off the board (via the no-repeat plan).
