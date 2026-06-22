---
# «Местный подряд» (Local Delivery) Quest — Clarity & Payout Fixes

## Overview
The generated "Местный подряд" delivery contract is confusing and can silently
fail to pay. Two player-reported symptoms ("can't tell what/how much to deliver
to the neighbouring planet" and "delivered Роскошь, nothing was credited") trace
to five concrete defects in the quest's copy, its target-system resolution, its
reward economics, and its on-landing completion check. This plan fixes all five
while keeping the logic **clean and isolated** — the player-facing completion
decision is extracted into a pure, unit-testable helper rather than smeared
across the Pixi scene.

Goals:
- The contract clearly states **how much** of **which** cargo to buy and **where**
  to deliver it (the in-system target planet, no jumps).
- Delivering the right cargo always pays; delivering the wrong amount gives the
  player **explicit feedback** instead of a silent no-op.
- The payout reliably exceeds the real market purchase cost, so the contract is
  never a hidden loss.
- The target system id is always a real system id (never a planet id), so
  completion can actually fire.

## Context
Files/components involved (confirmed by exploration):
- `src/systems/quests/QuestGenerator.ts`
  - `buildLocalDelivery(rng, planetId, bucket, i, day, origin)` (~L857) — builds
    the contract. Defects: description omits `targetAmount`; description says
    "сдать здесь же" while `targetPlanetId = pickTargetPlanet(origin)` may be a
    different (neighbouring) habitable planet; `resolvedSystemId = origin?.id ??
    planetId` uses a **planet id** as a system id when `origin` is null.
  - `pickTargetPlanet(system)` (~L447), `pickCargo(rng)` (~L968).
  - Caller `generateQuestBoard` (~L286) — already has `originSystemId` in scope.
- `src/presentation/PlanetScene.ts`
  - `checkDeliveryQuestCompletion()` (~L450) — runs on landing (`initialize` ~L351).
    Defect: `if (!stack || stack.amount < collectObj.targetAmount) continue;`
    (~L470) bails **silently** — no toast — when the carried cargo is short, so a
    player who bought too little (because the amount was hidden) sees nothing.
- `src/config/balance.ts`
  - `LOCAL_DELIVERY_REWARD_MARGIN = 1.5` (~L116), `RESOURCE_BASE_PRICES` (~L96).
    Reward is anchored to **base** price × margin, but market BUY price is
    `base × economyMult × driftMult × faction.buyMult` (`TradeSystem.getBuyPrice`
    ~L190) which can exceed base, so 1.5 may not cover the real cost.
- Existing tests (must stay green — see Development Approach):
  - `src/tests/quests/localDeliveryQuest.test.ts` — copy assertions (must still
    contain origin name, match `/рынк|закуп|купи/i`, never `орбитальн`/`развезти`).
  - `src/tests/quests/localDeliveryReward.test.ts` — asserts `reward ===
    round(base × amount × LOCAL_DELIVERY_REWARD_MARGIN)` **referencing the
    constant symbolically**, so bumping the constant keeps it green; a formula
    change would NOT.

Related patterns:
- Completion is system-level (`quest.targetSystemId === currentSystemId`); the
  named target planet is informational, not a hard gate (kept lenient on purpose).
- `QuestJournalUI` already renders live cargo count for `COLLECT_ITEM` objectives,
  so surfacing the amount in copy + objective text composes with the journal.

## Development Approach
- **Testing approach: TDD** — write the red regression test first, then fix until
  green, per the project's regression-first rule.
- **Do NOT modify or weaken any existing test assertion** (standing project rule).
  Every task ADDS tests. Specifically:
  - Keep the existing copy assertions in `localDeliveryQuest.test.ts` satisfiable
    (preserve the origin/system name and a `рынк|закуп|купи` token in the copy).
  - Fix economics by **raising the `LOCAL_DELIVERY_REWARD_MARGIN` constant only**
    (the existing reward test references the constant, so it stays green). Do not
    change the reward formula shape.
- **Keep it isolated / clean:** extract the on-landing completion decision into a
  pure helper (`deliveryShortfall`/`evaluateDelivery`) with no Pixi/DOM deps; the
  scene only renders the result. New pure logic lives next to the domain it
  serves, not inlined in `PlanetScene`.
- **Blast-radius first:** before editing each symbol, run `gitnexus impact` on it
  (`buildLocalDelivery`, `checkDeliveryQuestCompletion`, `LOCAL_DELIVERY_REWARD_MARGIN`)
  and confirm the touch-points; warn on HIGH/CRITICAL risk.
- Complete each task fully (code + tests green) before the next. Run
  `npm test -- --run <file>` for the touched tests, and the full suite at the end.

## Implementation Steps

### Task 1: Surface cargo amount + named destination in the contract copy
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts` (`buildLocalDelivery`)
- Modify: `src/tests/quests/localDeliveryQuest.test.ts` (ADD assertions only)

- [x] Run `gitnexus impact {target: "buildLocalDelivery", direction: "upstream"}`
      and note the blast radius (board generation, job board UI, tests).
      (Risk: LOW; only direct caller is `generateQuestBoard`.)
- [x] Resolve a human-readable destination name: the `pickTargetPlanet(origin)`
      planet's `name` (fallback to its id, then to the origin/system name) so the
      copy can name where the goods go.
- [x] Rewrite the description to state the **amount**, the **cargo label**, and
      the **named in-system destination, without jumps** — e.g. «закупить
      {targetAmount} ед. «{cargo.label}» на рынке {origin.name} и доставить на
      {targetPlanetName} (та же система, без прыжков)». Preserve a
      `рынк|закуп|купи` token and the origin/system name so existing copy
      assertions still pass; keep `орбитальн`/`развезти` absent.
- [x] Include the amount in the `COLLECT_ITEM` objective description (e.g.
      «Загрузить {targetAmount} ед. {cargo.label}») so the journal line is
      self-describing.
- [x] ADD test cases to `localDeliveryQuest.test.ts`: the description contains the
      numeric `targetAmount` and the cargo label; the objective description
      contains the amount. (Do not alter the existing assertions.)
- [x] Run `npm test -- --run src/tests/quests/localDeliveryQuest.test.ts` — green.

### Task 2: Always resolve a real target SYSTEM id (origin-null edge)
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts` (`buildLocalDelivery` + its caller)
- Modify: `src/tests/quests/localDeliveryQuest.test.ts` (ADD a regression case)

- [x] Thread `originSystemId` into `buildLocalDelivery` from `generateQuestBoard`
      (it is already in scope at the call site ~L286).
- [x] Set `resolvedSystemId = origin?.id ?? originSystemId` (a canonical system
      id) instead of `origin?.id ?? planetId`, so `template.targetSystemId` /
      `targetSystemId` are never a planet id. Keep `targetPlanetId` as the
      `pickTargetPlanet` result (may be null when origin is unknown).
- [x] ADD a regression test: call `generateQuestBoard` with an `originSystemId`
      that is NOT present in `systems` (forces `origin === null`); assert the
      resulting local-delivery `template.targetSystemId === originSystemId` (not
      the planet id), so `checkDeliveryQuestCompletion` can still match.
- [x] Run the quest tests — green.

### Task 3: Reward must exceed the real market purchase cost
**Files:**
- Modify: `src/config/balance.ts` (`LOCAL_DELIVERY_REWARD_MARGIN` value only)
- Create: `src/tests/quests/localDeliveryProfit.test.ts`

- [x] Inspect `TradeSystem.getBuyPrice` and the economy/drift/faction multipliers
      to bound the realistic worst-case buy markup over `RESOURCE_BASE_PRICES`
      (economyMult × driftMult × faction.buyMult).
      (Bound: `getMarketPrice` clamps to `base × 3.0`; max faction `buyMultiplier`
      is 1.0 → worst-case buy cost = `base × amount × 3.0`.)
- [x] Raise `LOCAL_DELIVERY_REWARD_MARGIN` so it comfortably exceeds that
      worst-case markup (keep a profit headroom). Change the **constant value
      only** — the formula `round(goodsCost × LOCAL_DELIVERY_REWARD_MARGIN)`
      stays, so `localDeliveryReward.test.ts` (which references the constant)
      remains green. Document the chosen margin with a comment tying it to the
      market markup. (1.5 → 3.5; ~17% headroom over the 3.0 ceiling.)
- [x] ADD `localDeliveryProfit.test.ts`: for each cargo type, assert the contract
      reward is strictly greater than the worst-case market buy cost
      (`base × amount × worstCaseBuyMarkup`), proving the contract is never a loss.
- [x] Run `npm test -- --run src/tests/quests/localDeliveryReward.test.ts
      src/tests/quests/localDeliveryProfit.test.ts` — both green.

### Task 4: Explicit feedback instead of a silent no-payout (pure helper)
**Files:**
- Create: `src/systems/quests/deliveryCompletion.ts` (pure helper)
- Modify: `src/presentation/PlanetScene.ts` (`checkDeliveryQuestCompletion`)
- Create: `src/tests/quests/deliveryCompletion.test.ts`

- [x] Run `gitnexus impact {target: "checkDeliveryQuestCompletion"}` and confirm
      the only caller is `PlanetScene.initialize`.
      (Risk: LOW; sole d=1 caller is `PlanetScene.initialize`.)
- [x] Create a pure helper, e.g. `evaluateDelivery(quest, player, currentSystemId)`
      returning a discriminated result: `{ kind: "complete", collectObj, stack }`
      | `{ kind: "shortfall", cargo, required, carried }` | `{ kind: "n/a" }`.
      No Pixi/DOM imports — domain-only. This is the single source of truth for
      "can this delivery complete here, and if not, why".
      (`src/systems/quests/deliveryCompletion.ts`; structural inputs so tests
      need no full Quest/Player.)
- [x] Refactor `checkDeliveryQuestCompletion` to call the helper: on `complete`,
      keep the existing force-complete + cargo-deduct + reward toast; on
      `shortfall`, show an informative toast naming the cargo and the
      carried/required counts (e.g. «{quest.title}: нужно {required} ед.
      «{cargo}», в трюме {carried}») instead of silently `continue`-ing. Gate the
      shortfall toast to delivery quests targeting the current system so it is not
      spammy mid-journey, and show at most one per landing.
      (Gate is inherent: `evaluateDelivery` returns `n/a` for non-current-system
      quests; `shortfallShown` flag caps it at one toast per landing.)
- [x] ADD `deliveryCompletion.test.ts` covering: exact amount → complete; over
      amount → complete; below amount → shortfall with correct counts; missing
      cargo → shortfall; wrong system → n/a. (Pure function, no scene needed.)
- [x] Run `npm test -- --run src/tests/quests/deliveryCompletion.test.ts` — green.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] Confirm every Overview goal is met: amount + named destination in copy
      (`QuestGenerator.ts` L900 description + L905 objective); shortfall feedback
      on landing (`deliveryCompletion.ts` discriminated result + `PlanetScene.ts`
      L478-488 toast with required/carried counts); payout > market cost
      (`LOCAL_DELIVERY_REWARD_MARGIN = 3.5` > 3.0 ceiling); target system id always
      a real system id (`resolvedSystemId = origin?.id ?? originSystemId`).
- [x] Ran `detect_changes({scope: "compare", base_ref: "master"})`: across the
      four task commits only the expected files/symbols are affected — `balance.ts`,
      `PlanetScene.ts`, `QuestGenerator.ts`, new `deliveryCompletion.ts` + tests; no
      unrelated quest types touched.
- [x] Ran the full unit suite `npm test -- --run` — all green (292 files, 2558
      tests), including the untouched `localDeliveryQuest`/`localDeliveryReward`
      assertions.
- [x] Ran `npm run lint` — 0 errors (only pre-existing `any` warnings in unrelated
      test files).

### Task 6: Update documentation
**Files:**
- Modify: `docs/` quest/requirements notes if the contract is documented there.

- [x] Verified the "Местный подряд" contract is NOT described in any
      requirements/design/architecture/reference doc — only in `docs/plans/`
      (this active plan + the completed `20260618-route-crosshair-and-delivery-quest-economics.md`,
      which are historical working docs, not living requirements). EPIC-008
      documents only the generic cross-system DELIVERY quest ("haul to system N"),
      not this same-system buy-and-deliver variant. Per the conditional ("If not
      documented, no change"), no documentation change is needed.

## Technical Details
- Reward formula shape is unchanged: `round(base × amount × LOCAL_DELIVERY_REWARD_MARGIN)`.
  Only the constant rises so it dominates the worst-case `getBuyPrice` markup.
- Completion stays **system-level and lenient** (landing any planet in the target
  system with the cargo completes it); the named target planet is informational.
  This is deliberate — do not tighten completion to a specific planet (avoids
  making the contract harder and keeps blast radius small).
- The new `evaluateDelivery` helper is pure (no PixiJS/DOM), so it is unit-tested
  directly and reused without dragging scene state into tests.
- No `src/types` / `src/domain` / Zod schema changes → no save-version bump.

## Post-Completion
**Manual verification:**
- In-game: accept «Местный подряд», read that the copy now names the cargo,
  amount, and destination; buy the exact amount; land and confirm the credit
  arrives with a toast.
- In-game negative path: buy fewer than required, land, and confirm the shortfall
  toast explains what is still needed (no silent no-op).
- Spot-check a luxury contract in a system where luxury is expensive to confirm
  the payout still nets a profit.
