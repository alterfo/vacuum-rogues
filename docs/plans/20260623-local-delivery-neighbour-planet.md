---
# «Местный подряд» Delivers to a Neighbouring Planet (not the same one)

## Overview
The «Местный подряд» local contract frequently targets the **same planet** the
player buys on ("buy here, deliver here"), which is illogical. Make it a genuine
intra-system courier run: the goods go to a **different planet in the same
system**, and the player must actually **fly there and land** to complete it
(still no hyperjumps). Systems with only one planet no longer generate a local
contract at all.

Causes:
1. `pickTargetPlanet(origin)` returns the system's habitable planet (or
   `planets[0]`) with **no reference to the issuer planet** — and since contracts
   are accepted on the habitable planet, the target is usually that same planet.
2. The accepted Quest carries only **`targetSystemId`** (not a planet), so
   completion (`evaluateDelivery` → `checkDeliveryQuestCompletion`) is
   **system-level** — landing on *any* planet in the system completes it, so even
   a renamed neighbour wouldn't force a real delivery.

Goal: target ≠ issuer (a real neighbour), completion requires landing on that
neighbour with the cargo, and single-planet systems fall back to a different quest.

## Context (from discovery)
- **Target pick:** `src/systems/quests/QuestGenerator.ts` — `pickTargetPlanet`
  (~L455, habitable-or-`planets[0]`, no exclusion) and `buildLocalDelivery`
  (~L866, calls `pickTargetPlanet(origin)`, builds the copy + `targetPlanetId`).
- **Generation trigger:** local delivery is the fallback when `reachable.length
  === 0` (no other system reachable — common when fuel-limited), in the board
  builder's `if (isText || reachable.length === 0)` branch (~L282) which otherwise
  builds a text quest.
- **Quest carries no planet:** `Quest`/`QuestTemplate` (`src/types/index.ts`
  ~L201/L265) + `QuestSchema` (`src/validation/schemas.ts` ~L167) have
  `targetSystemId`/`targetObjectId` but **no `targetPlanetId`**. `acceptBoardQuest`
  (`QuestManager.ts:108`) stores only `targetSystemId`.
- **Completion:** `evaluateDelivery(quest, player, currentSystemId)` (the pure
  helper, `src/systems/quests/deliveryCompletion.ts`) is system-level; consumed by
  `PlanetScene.checkDeliveryQuestCompletion` (~L463).
- **⚠️ Existing tests use single-planet isolated systems:**
  `src/tests/quests/localDeliveryQuest.test.ts` and `localDeliveryReward.test.ts`
  build `isolatedSystem()` with **one** planet (`ISO_p1`). The new "needs a
  neighbour" rule means those fixtures must grow a 2nd planet so a local delivery
  still generates — a **feature-driven fixture update** (original assertions
  preserved), not a weakening.

## Development Approach
- **Testing approach: TDD** — red test first (target ≠ issuer; landing on the
  issuer planet does NOT complete; landing on the neighbour does), then fix.
- **Lockstep:** adding `targetPlanetId` to the Quest touches `src/types/index.ts`
  **and** `src/validation/schemas.ts` together (optional/nullable, default null →
  no save-version bump; pre-existing quests fall back to system-level completion).
- Run `gitnexus impact` on `pickTargetPlanet`, `buildLocalDelivery`,
  `evaluateDelivery`, and `acceptBoardQuest` first. Keep changes additive; don't
  weaken existing assertions (update only the single-planet fixtures, with reason).

## Implementation Steps

### Task 1: Pick a neighbour (≠ issuer); skip single-planet systems
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts` (`pickTargetPlanet`, `buildLocalDelivery`, board caller)
- Modify (fixtures): `src/tests/quests/localDeliveryQuest.test.ts`, `localDeliveryReward.test.ts`
- Create: `src/tests/quests/localDeliveryNeighbour.test.ts`

- [x] Give `pickTargetPlanet` an `excludeId` (the issuer planet): prefer a
      different habitable planet, else any other planet, else `null` (no neighbour).
- [x] In `buildLocalDelivery`, pass the issuer `planetId` as `excludeId` and set
      `targetPlanetId` to the resulting neighbour; update the copy to name the
      neighbour ("доставить … на {neighbour} в этой же системе, без прыжков").
- [x] In the board builder, when `reachable.length === 0` **and** the origin
      system has `< 2` planets, build a **text quest** instead of a local delivery
      (no same-planet contract is ever emitted). (Unknown/null origin — tests only —
      keeps the legacy system-level local delivery.)
- [x] Update the existing single-planet fixtures to 2 planets so they still
      produce a local delivery; preserve their original assertions.
      (`localDeliveryQuest`/`localDeliveryReward`/`localDeliveryProfit`.)
- [x] write tests: multi-planet system → `targetPlanetId` ≠ issuer (habitable
      neighbour preferred); single-planet isolated system → the slot is a text
      quest, not «Местный подряд». (`localDeliveryNeighbour.test.ts`.)
- [x] run touched tests — green.

### Task 2: Carry the target planet on the accepted Quest (lockstep)
**Files:**
- Modify: `src/types/index.ts` (`Quest`/`QuestTemplate` `targetPlanetId`)
- Modify: `src/validation/schemas.ts` (`QuestSchema` `targetPlanetId`, optional)
- Modify: `src/systems/QuestManager.ts` (`acceptBoardQuest` stores it)
- Create/Modify tests under `src/tests/`

- [x] Add optional `targetPlanetId` to the Quest type + `QuestSchema`
      (`z.string().nullable().default(null)` → old saves validate, no version bump).
- [x] `acceptBoardQuest` copies `template.targetPlanetId ?? null` onto the Quest.
- [x] write tests: an accepted local-delivery quest exposes `targetPlanetId ===`
      the neighbour; a save/quest without the field validates and defaults `null`.
- [x] run touched tests — green.

### Task 3: Completion requires landing on the target planet
**Files:**
- Modify: `src/systems/quests/deliveryCompletion.ts` (`evaluateDelivery`)
- Modify: `src/presentation/PlanetScene.ts` (`checkDeliveryQuestCompletion` passes the planet)
- Create/Modify tests under `src/tests/`

- [ ] Extend `evaluateDelivery` to take the current **planet id** and, when the
      quest has a `targetPlanetId`, require `currentPlanetId === targetPlanetId`
      (in addition to the system + cargo checks). When `targetPlanetId` is null
      (legacy quests), keep the system-level behaviour (back-compat).
- [ ] Thread the current planet id from `checkDeliveryQuestCompletion`.
- [ ] write tests: landing on the **issuer** planet with cargo → not complete (n/a
      / wrong planet); landing on the **target** planet with cargo → complete; on
      the target planet but short cargo → shortfall; a legacy quest (null target
      planet) → still completes system-level.
- [ ] run touched tests — green.

### Task 4: Navigation points to the neighbour
**Files:**
- Modify: route/marker wiring if it reads the quest target (flight `RouteRenderer`/
  quest journal) — verify it uses `targetPlanetId`
- Create/Modify tests under `src/tests/`

- [ ] Confirm the in-flight route / quest-journal destination for a local delivery
      points at the **neighbour** `targetPlanetId` (not the issuer), so the player
      can navigate there; wire it if it currently keys off the system only.
- [ ] write/extend a test for the destination resolution.
- [ ] run touched tests — green.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only quest
      generation/completion + schema affected.
- [ ] full unit suite `npm test -- --run` green (incl. the updated fixtures);
      `npm run lint` clean; `npm run build` succeeds.

### Task 6: Update documentation
**Files:**
- Modify: quest/requirements docs if «Местный подряд» is documented.

- [ ] Note the new rule: local contracts deliver to a different in-system planet
      (never the issuer), require landing there, and don't generate in single-planet
      systems.

## Technical Details
- `targetPlanetId` is an additive optional field → no save migration; legacy
  quests (null) keep system-level completion.
- "Neighbour" = a different planet in the **same** system → still no hyperjumps.

## Post-Completion
**Manual verification:**
- Accept «Местный подряд», confirm the destination is a *different* planet in the
  system; buy the cargo; landing back on the issuer planet does NOT complete it;
  flying to and landing on the named neighbour with the cargo completes it + pays.
- In a single-planet system, confirm no «Местный подряд» appears.
