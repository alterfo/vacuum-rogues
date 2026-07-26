# Branching text-quests (`QuestScript`s)

Each file in this folder is one hand-authored **branching text-quest** — a
`QuestScript` (`../QuestScript.ts`) executed by `QuestVM` (`../QuestVM.ts`) and
played in `TextQuestScene`. Unlike the *procedural* board quests
(DELIVERY/BOUNTY/ESCORT/… generated in `../QuestGenerator.ts`), these are
graph-shaped: real choice points, branches, and distinct success/failure
outcomes with credit / reputation / cargo effects.

Player-facing copy is **Russian** (project norm); code and comments are English.
Scripts are pure catalog data — adding one needs **no save migration**.

**Prose quality bar** (established `docs/plans/20260706-three-year-campaign.md`
Task 13, applied to all 20 scripts): life-and-death framing in the setup,
concrete sensory detail, choices that read as decisions rather than menu items,
endings that acknowledge the path taken, and — where the puzzle allows it —
choice labels that surface the numeric tradeoff (fuel cost, current load,
meter delta) so the optimal path requires reasoning, not guessing, while a
survivable non-optimal path stays open.

## Text-pool variance (replayability)

`QuestLocation.text` is `string | string[]`. A plain `string` renders
verbatim; a **`string[]` is a variance pool** — the quest reads differently
across playthroughs without touching mechanics. `QuestVM.currentLocationText()`
(via the pure `resolveLocationText`, `../QuestVM.ts`) picks one variant
**deterministically from `(seed, locationId)`** using an RNG-free stable hash
(`questTextHash`). It intentionally does **not** consume the VM's `SeededRNG`
stream, so adding or removing a variant never silently shifts an
already-shipped quest's `random(min,max)` rolls (those depend on call order
into `this.rng`). Within a single run the same location always resolves to the
same variant; a different seed (a new board quest, or a `TextQuestScene`
restart's fresh attempt seed) can surface a different one.

Convention (introduced by `docs/plans/20260726-quest-and-hub-polish-pass.md`
Task 14, applied per-quest in Tasks 15–34):
- Reach for a pool where **replay variety is the actual fix** (a recurring
  screen that reads identically every run — e.g. `customs.ts`'s per-shift
  captain vignettes). It gives *per-playthrough* variety keyed on the run seed,
  **not** per-visit variety within one run (the resolver is stable per run).
- Every variant in a pool must keep the same `{param}` interpolation
  placeholders; the `questScriptGraph.test.ts` "placeholder resolves to a
  declared param" invariant now checks **every** string in a `text` array.
- Pools are still pure catalog data — no schema, migration, or save-bump
  (`resolveLocationText` derives everything at render time).

## Catalogue

A script is live the moment it is listed in `ALL_QUEST_SCRIPTS`
(`../TextQuestRegistry.ts`). Current set (20):

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
| `evacuation` | Эвакуация станции «Терминус» | Logistics routing under a draining evac window — order + route shuttle runs to maximise the `saved` headcount before the reactor breaches (out of time loses everyone) |
| `locked-room` | Убийство на «Гелиосе» | Locked-room whodunit — gather `clues` and accuse the right suspect before the airlock realigns; a conviction needs both the correct name AND enough proof (wrong / unproven / too-late failures) |
| `life-support` | Кислородный расчёт | Resource-optimisation puzzle — ration a fixed `oxygen` reserve across sealed sections to save the most; reserve hits zero mid-op ⇒ mass decompression failure |
| `boarding-standoff` | Переговоры на абордаже | Negotiation under pressure vs a raider boarding party — build `leverage` while keeping `tension` below the boiling point (firefight / drawing-first failures) |
| `signal-decode` | Расшифровка сигнала | Cryptanalysis under a decoder `power` budget — raise `clarity` to recover a distress code before the array browns out; efficient pattern-deduction beats brute force (garbled / power-lost failures) |
| `orbital-escape` | Срыв с орбиты | Orbital burn-scheduling — raise `altitude` above escape before a decaying orbit burns you up, spending a finite `fuel` budget (periapsis burns are efficient); stranded / burn-up failures |
| `tribunal` | Трибунал | Courtroom defense — build `defense` while keeping the judge's `hostility` below contempt; aggression is strong but inflames, concession buys goodwill (guilty / contempt failures) |
| `quarantine` | Карантин | Containment-ethics dilemma — hold `containment` and keep `panic` in check while pulling out the most `saved`; a breach or a riot loses the station (distinct from `plague-crisis`'s time-race triage) |

The 6 below the first divider (`derelict-salvage` … `plague-crisis`) were added by
`docs/plans/20260625-more-interesting-quests.md`; the 4 after them
(`evacuation` … `boarding-standoff`) by Task 14 of
`docs/plans/20260706-three-year-campaign.md`, and the last 4
(`signal-decode` … `quarantine`) by Task 15 of the same plan. The design comment
at the top of each file documents its choice points and every ending.

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
