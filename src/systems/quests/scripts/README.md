# Branching text-quests (`QuestScript`s)

Each file in this folder is one hand-authored **branching text-quest** — a
`QuestScript` (`../QuestScript.ts`) executed by `QuestVM` (`../QuestVM.ts`) and
played in `TextQuestScene`. Unlike the *procedural* board quests
(DELIVERY/BOUNTY/ESCORT/… generated in `../QuestGenerator.ts`), these are
graph-shaped: real choice points, branches, and distinct success/failure
outcomes with credit / reputation / cargo effects.

Player-facing copy is **Russian** (project norm); code and comments are English.
Scripts are pure catalog data — adding one needs **no save migration**.

## Catalogue

A script is live the moment it is listed in `ALL_QUEST_SCRIPTS`
(`../TextQuestRegistry.ts`). Current set (12):

| `id` | Title | Theme |
|------|-------|-------|
| `customs` | Таможня | Customs inspection / paperwork |
| `gravity-slalom` | Гравитационный слалом | Pilot a gravity-well slalom |
| `investigation` | Следствие | Staged investigation |
| `cargo-sort` | Сортировка грузов | Sort a mixed cargo hold |
| `reactor` | Реактор | Stabilise a failing reactor |
| `auction` | Аукцион | Bid at an auction |
| `derelict-salvage` | Дрейфующий сухогруз | Salvage mystery aboard a drifting freighter — board choice, a bio-container dilemma, report vs black-market (1 failure: outbreak) |
| `smuggling-run` | Контрабандный рейс | Run contraband past 3 blockade checkpoints — bribe / bluff / dump, payout scales with surviving cargo (heat & getting-caught failures) |
| `hostage-rescue` | Спасение заложников | Free hostages from pirates — pay ransom (trust roll) / stealth / assault (scales with randomised guard count) |
| `sabotage-heist` | Налёт на хранилище | Vault heist with a **betrayal branch** — entry (bribe/hack/force), what to grab, and a partner who may double-cross you |
| `first-contact` | Первый контакт | Diplomacy with an alien vessel driven by a `trust` meter — **peace vs hostility** outcomes |
| `plague-crisis` | Эпидемия на колонии | Race a draining `time` budget to a plague colony, then triage / treat-all / profiteer (running out of time loses the colony) |

The 6 below the divider (`derelict-salvage` … `plague-crisis`) were added by
`docs/plans/20260625-more-interesting-quests.md`; the design comment at the top
of each file documents its choice points and every ending.

## Recipe: add a branching quest

1. **Author** `src/systems/quests/scripts/<id>.ts` exporting a `QuestScript`
   with a stable, unique `id`. Start from the comment-block convention in
   `derelict-salvage.ts` (list every choice point and ending). Use `params` for
   state (credits/rating/heat/trust/time…), `locations` for stages, and each
   `QuestLocation.transitions[].effects` for the credit/reputation deltas; mark
   terminal stages `isSuccess` / `isFailure`. A `critMin`/`critMax` redirect is
   the idiom for a time/heat-pressure spine (see `plague-crisis`).
2. **Register** it in `ALL_QUEST_SCRIPTS` (`../TextQuestRegistry.ts`) — the
   single wire-in point. That makes it resolvable via `getQuestScript(id)` and
   eligible for the board's TEXT_ADVENTURE slot, which `buildTextQuest`
   (`../QuestGenerator.ts`) fills by picking uniformly at random from
   `ALL_QUEST_SCRIPTS` and storing the chosen `script.id` as the quest's
   `targetObjectId`.
3. **Test** it in `../../../tests/quests/newQuestScripts.test.ts`: drive each
   choice path through `QuestVM` so every branch reaches a terminal stage,
   assert rewards/reputation fire on the correct branch, and assert no
   unreachable/dead stages. The registry test there also enforces that every
   `id` in `ALL_QUEST_SCRIPTS` is unique and resolves via `getQuestScript`.

Keep ids **unique and stable** — the board "no repeats" dedupe keys on them.
