# EPIC-008: Quest Generation & Galaxy-Spanning Missions

> Canon: [SOURCE-OF-TRUTH §8 "Quests & reputation"](../reference/SOURCE-OF-TRUTH.md#8-квесты-и-репутация)
> and [§11.1 "Planet screen"](../reference/SOURCE-OF-TRUTH.md#11-дайджест-механик-планет-кораблей-и-станций).
> Text-quests (a special sub-type) live in [EPIC-005](EPIC-005-text-quests-onnx.md).

## Description
The **issuing and distribution** layer for quests: planet governments and other
structures (military/science/pirate bases, individual NPCs) generate jobs that
**send the player across the whole galaxy** rather than circling one system. This
is a "mission director" on top of the existing `QuestManager`/`Quest`: it decides
which quests are posted at a given planet, of what type, where they lead, how much
they pay, and when they expire.

Core design idea: **text-quests (EPIC-005) are the cherry on top.** Ordinary
"routine" quests (delivery / bounty / escort / diplomacy / exploration) are the
bread that motivates flying and earning; roughly **1 in 5** issued quests is a
branching text-novella (hard, multi-step, "the original ones you beat on the
tenth try"). Rarity makes them an event, not background noise.

## Business Value
Turns the galaxy from scenery into a **space of goals**. Without a director,
quests are either local or samey; with it the player always has a reason to jump
to the next sector (deadline + reward + reputation). It is the session "engine"
that ties trading (EPIC-001), fitting (EPIC-007), the living galaxy (EPIC-003)
and text-quests (EPIC-005) into the loop "take a job → fly → complete → grow
stronger → take a harder one."

## User Stories

| ID | Title | Status |
|----|-------|--------|
| US-080 | Planet job board: list of available quests with type/target/reward/deadline | In Progress (`JobBoardPanel` + PlanetScene «Задания» + `GameEngine.getQuestBoard/acceptBoardQuest`; needs live check). Board **deduplicates** — see "Board dedupe (no repeats)" below. |
| US-081 | Quest generator: deterministic from seed+day-bucket; tunable text ratio | **Done** (`QuestGenerator`, tests) |
| US-082 | Galaxy reach: quest target is **another** system/planet, jump distance computed | **Done** (BFS `jumpDistance`, tests) |
| US-083 | Reward balance: reward/penalty/deadline scale with distance (jumps) and route risk | **Done** (`economics`, tests) |
| US-084 | Type mix: ~1 in 5 quests is a text-quest (EPIC-005), the rest are routine; tunable share | In Progress (gen emits at ratio; scene trigger pending EPIC-005) |
| US-085 | Chains & reputation gates: hard/lucrative quests unlock with good reputation and rank | Planned |
| US-086 | Galaxy-wide progress tracking: "cargo delivered", "target destroyed", "system reached" close objectives | Planned |
| US-087 | Persist the board and active quests in the save (`schemas.ts` + `MigrationPipeline`) | Planned |

## Acceptance Criteria (Epic Level)
- [ ] A planet has a **job board**: a set of quests deterministic from
      `seed + refresh-day + planetId`, refreshing over time.
- [ ] The board offering depends on the **owner faction, economy type and the
      player's reputation** (bad reputation → no government quests; high rank →
      elite quests available).
- [ ] **Most quests lead to other systems**: the delivery/bounty/escort/scout
      target is not in the issuing system; reward/deadline depend on the number of
      hyperjumps to the target and route danger.
- [ ] The share of **text-quests** among issued quests ≈ **1 in 5** (a tunable
      balance parameter); a text-quest launches the EPIC-005 scene.
- [ ] Progress is closed by **simulation events** (cargo delivered on the right
      planet, hunt target destroyed, scout point reached), not by hand.
- [ ] Deadlines and failures work (existing `Quest.deadline`, `failurePenalty`,
      `checkExpiredQuests`); expiry → reputation/credit penalty.
- [ ] The board and active quests are saved/restored.
- [ ] The generator and objective-closing are covered by unit tests (deterministic
      from seed).

## Design: quest types and "galaxy reach"
All types already exist in `QuestType` (`DELIVERY/BOUNTY/ESCORT/DIPLOMACY/
EXPLORATION`) plus `TEXT_ADVENTURE` (EPIC-005). The point of each is to **draw the
player out of the system**:

| Type | Where it leads | What it motivates |
|------|----------------|-------------------|
| Delivery (DELIVERY) | pick up cargo here → haul to system N | trade logistics + deadline |
| Bounty (BOUNTY) | target NPC "lives" in another system (EPIC-003) | intercept, combat (EPIC-002) |
| Escort (ESCORT) | escort an NPC to system N | protection en route, ambush risk |
| Diplomacy (DIPLOMACY) | deliver an ultimatum/offer to a faction | reputation branches |
| Exploration (EXPLORATION) | reach/scan a distant object | map reveal, finds |
| **Text-quest (TEXT_ADVENTURE)** | local but **branching** | the "cherry": 1 in 5, EPIC-005 |

**The 1-in-5 share** is our design knob (`QUEST_TEXT_RATIO`), not canon:
text-quests are expensive in player attention, so they are rare and served as a
reward for browsing the board, not as routine.

## Board dedupe (no repeats)
The board must not re-offer a quest the player is **already engaged with**
(`docs/plans/20260625-quests-no-repeat.md`). `QuestGenerator` exposes a stable
content key — `questKey(generated)` / `questKeyForQuest(quest)` — formed from the
quest **type + target system + a destination signature derived from the
objectives** (reward / quantity / slot id are deliberately excluded, so the key is
stable across a board refresh and matches an already-accepted copy of the same
quest).

`generateQuestBoard(opts)` takes an opt-in `excludeKeys` set; any candidate whose
`questKey` is in that set — or that was already placed on the board being built —
is skipped, and the slot loop **back-fills from the remaining pool** so the board
still reaches its target size. When `excludeKeys` is `undefined` the output is
byte-identical to the legacy generator (every existing seeded/length test stays
green); seeded determinism is preserved either way.

`GameEngine.getQuestBoard` threads the exclusions in, mirroring the existing
`completedQuestChains` wiring: it maps the player's **active + pending-return**
quests through `questKeyForQuest` into `excludeKeys`. **Completed** quests are
ids-only (no retained template), so they continue to be deduped by **id** in the
existing post-filter. All exclusions derive from already-persisted state (active
log + completed-id set), so there is **no new save field, schema, or migration**.

### Mechanics & known limitations
- **Two passes, two jobs.** A pre-existing `taken` id-filter in `getQuestBoard`
  removes any board entry whose template id is already active/pending/completed —
  this is the actual repeat backstop within a board-refresh bucket (an accepted
  quest keeps its generated template id, e.g. `gen_<planet>_<bucket>_<i>`). The
  `excludeKeys` content-key dedupe runs *inside* `generateQuestBoard` and its main
  added value is **back-filling** so the board stays full after a quest is taken,
  rather than shrinking until the next bucket.
- **Chain-part rollback.** `buildForSlot` advances the per-board chain counter as
  it builds; the fill loop **rolls that counter back when a built quest is
  skipped** (excluded/duplicate), so an excluded earlier chain part can never
  leave a later part orphaned on the board (regression-tested in
  `questBoardDedupe.test.ts`).
- **BOUNTY key is content-only.** `acceptBoardQuest` rewrites a bounty's
  `targetSystemId` to the bound pirate's current system (and a `DEFEAT_ENEMY`
  objective carries no destination signature), so an accepted bounty's
  `questKeyForQuest` may not match the generated `questKey` when the pirate is not
  in the original target system. The id-filter still prevents the repeat; the only
  effect is that such a bounty is not back-filled, so the board can show one fewer
  entry. A stable bounty key would need a keyable ship-identity field on `Quest`
  (a domain field + schema + migration) — deliberately out of scope here.

## Dependencies
- `QuestManager`/`Quest`/`QuestObjective`/`Reward`/`failurePenalty` — exist (the base).
- EPIC-006 (planet hub) — home of the job board and the owner info panel.
- EPIC-003 (living galaxy) — hunt/escort targets as real NPC ships.
- EPIC-005 (text-quests) — the sub-type launched at the ~1/5 share.
- EPIC-001 (markets) — cargo and prices for delivery quests.
- EPIC-009 (info center) — where the player looks up a quest target's location.

## Affected Components (plan)
- `src/systems/quests/QuestGenerator.ts` (new) — deterministic board generation
  (type, target system, cargo/target, reward, deadline) from seed+day+planet.
- `src/systems/QuestManager.ts` — accept generated quests, close objectives from
  simulation events, expire deadlines.
- `src/types/index.ts` — `QuestType.TEXT_ADVENTURE`, "target system/object" fields,
  the `QUEST_TEXT_RATIO` balance parameter.
- `src/domain/Quest.ts` — target in another system (targetSystemId/targetObjectId).
- `src/presentation/` — job board on the planet screen (EPIC-006), journal
  integration (`QuestJournalUI`).
- `src/validation/schemas.ts`, `src/data/MigrationPipeline.ts` — persist the board.

## Deliberate Deviations from Canon
- Concrete quest texts/names are **ours**; routine quests are procedural.
- The text-quest share (1/5) and distance-based reward formulas are our balance;
  canon has no explicit ratio.

## Implementation Plan
Slices tracked in `DEVELOPMENT_PLAN.md` as **Feature 13**. Order: US-081
(generator — pure logic, testable without UI) → US-082/083 (galaxy reach +
balance) → US-080 (board on the planet, needs EPIC-006) → US-086 (close
objectives from events) → US-084 (mix with text-quests, needs EPIC-005) →
US-085/087 (gates, persistence).
