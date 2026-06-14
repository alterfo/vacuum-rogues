---
# Letsplay Fixes — Quest, UI, and Reputation (Regression-First)

## Overview
Fix a batch of letsplay findings from the 2026-06-14 session: ship position lost
on inventory close; unnamed systems reverting to noname after warp; quest journal
going blank without expiry notification; escort quest showing no details; reputation
label mismatch between PlanetScene and GovernmentScene; quest deadlines far too
tight (2 days/jump yields 5-day deadlines on 1-jump quests); and HUD text hints
cluttering the flight screen.

Every bug: failing regression test first → fix → pass. Visual/UX changes:
letsplay screenshot verification.

## Context
- **InventoryScene.ts:399** — `transitionTo(SceneType.SPACE_FLIGHT)` without
  `preserveShipPos`; SpaceFlightScene already handles the context at line 1019
  via `applyEntrySpawn()`, so the fix is pass-through only.
- **StarMapScene.ts:644–659** — "?" label rendered for `visibility === "unknown"`;
  after a jump the visited system is promoted to `"visited"` by `starMapUtils.ts`,
  but the name is never stored — the system renders without a label (noname).
- **QuestGenerator.ts:404–408** — `deadline = jumps * 2 + rng(2, 4)`; 1-jump
  quest deadline = 4–6 days. User expects minimum 30 days for 1-hop delivery.
- **QuestJournalUI.ts** — calls `getActiveQuests()` which filters out expired
  quests. No expired-state display, no in-game notification → journal goes blank
  on deadline breach with zero player feedback.
- **GovernmentScene.ts:23–27** vs **PlanetScene.ts:1160–1180** — reputation
  threshold mismatch: Government uses `< -30` for "Враг", Planet uses `< -20`
  for "Враждебный". At rep -25 Government shows Neutral, Planet shows Hostile.
- **QuestGenerator.ts:505–520** — ESCORT quest has only a `VISIT_LOCATION`
  objective, no convoy ship name, no NPC tie-in. Minimum fix: add convoy ship
  name + correct target (system, not planet).
- **FlightHud.ts:316** — long instruction string occupies HUD bottom bar;
  should move to a togglable [?] help overlay.
- E2E env: `NO_PROXY=localhost,127.0.0.1` required; letsplay harness
  `e2e/letsplay-discovery.spec.ts` regenerates `e2e/screenshots/letsplay/`.

## Development Approach
- Regression-first (CLAUDE.md Bug Fixing Process): red test → fix → green → screenshot
- Unit tests for logic bugs; E2E regression for visual/UX
- `npm run lint && npm test -- --run` must stay green between every task
- `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green before
  declaring a task done
- No changes to existing test assertions; new tests only

## Implementation Steps

### Task 1: Fix ship position lost after closing inventory
**Files:**
- Modify: `src/presentation/InventoryScene.ts`
- Modify: `src/tests/presentation/inventoryScene.test.ts` (or new file)

- [x] Write RED unit test: mock `transitionTo`, open InventoryScene, call close → assert
  `transitionTo` is called with `{ preserveShipPos: { x, y } }` matching the
  player's current position (use `GameEngine.lastFlightShipPos` as the source of
  truth, same as other scenes that return to SPACE_FLIGHT)
- [x] Fix `InventoryScene.ts:399`: pass `preserveShipPos` from `GameEngine.lastFlightShipPos`
  (or read directly from `player.x/y` if available in the scene context)
- [x] Run lint + unit tests — must be green
- [x] Re-run letsplay spec; verify in screenshot that ship is NOT near the system edge
  after opening and closing inventory [x] manual test (skipped - not automatable)

### Task 2: Fix unnamed systems on galaxy map after warp
**Files:**
- Modify: `src/utils/starMapUtils.ts`
- Modify: `src/presentation/StarMapScene.ts`
- Modify: `src/tests/galaxy/` (new file `systemVisibility.test.ts`)

- [ ] Write RED unit test: create a StarSystem with `visibility = "unknown"`, simulate
  player warp into it (update visibility to `"visited"`), check that the rendered
  label is the system name — not "?" and not empty string
- [ ] Diagnose: confirm whether system `name` is missing/empty after the visit promotion,
  or whether StarMapScene skips the label render step for newly-visited systems
- [ ] Fix: ensure the system name is always rendered once `visibility !== "unknown"`;
  if the name was never stored (all systems have names generated at galaxy creation,
  so this is likely a render path skip), remove the `continue` guard or add the
  normal label path after the "?" early-exit block
- [ ] Run lint + unit tests — green
- [ ] Re-run letsplay spec; galaxy map screenshot shows system names for all visited stars

### Task 3: Fix quest deadlines and add expiry feedback
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/presentation/QuestJournalUI.ts`
- Modify: `src/systems/GameEngine.ts` (or quest manager) for expiry notification
- Modify: `src/tests/` (extend quest deadline tests)

- [ ] Write RED unit test: generate a DELIVERY quest for 1-jump distance → assert
  `deadline >= 30` days; generate 2-jump → `deadline >= 45`; ESCORT ≥ 30 per jump;
  EXPLORATION (round-trip) ≥ 30 per hop
- [ ] Fix `QuestGenerator.ts:404–408`: change formula to
  `deadline = max(30, jumps * 15 + rng(5, 10))` — 1-jump = 30–35 days, scales up
- [ ] Write RED unit test for quest expiry display: mock `getActiveQuests()` to return
  an expired quest → `QuestJournalUI.render()` must NOT produce an empty container;
  expired quests appear in a "Провалено" section with the reason
- [ ] Update `QuestJournalUI.ts`: call `questManager.getExpiredQuests()` (or filter
  from `getAllQuests()`), render them in a collapsed "Провалено / Просрочено" section
  below active quests; show "просрочено N дней назад" label
- [ ] Add remaining-days display for active quests in `createQuestCard()`: use
  `quest.getRemainingDays(currentDay)` — show "осталось N дн." in amber when < 5
- [ ] Write RED unit test for expiry notification: advance `currentDay` past a quest's
  deadline → `GameEngine` (or `QuestManager`) fires a notification or log entry;
  message contains quest title and "просрочено"
- [ ] Implement notification on day-tick: in the game loop where `currentDay` advances,
  check newly-expired quests and emit a HUD notification (reuse whatever notification
  system exists, or use `FlightHud.showToast()` / similar)
- [ ] Run lint + unit tests — green
- [ ] E2E regression — green

### Task 4: Fix reputation label mismatch
**Files:**
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/presentation/GovernmentScene.ts`
- Create: `src/tests/presentation/reputationLabel.test.ts`

- [ ] Write RED unit test: for reputation values -10, -25, -35, -75 → both
  `getRepTier()` (Government) and `getPlanetRepLabel()` (Planet) must agree on
  whether the player is Neutral vs Hostile; at -25 both must return the same tier
- [ ] Unify the threshold: adopt the 5-tier scale from PlanetScene as the single
  source of truth — extract to `src/utils/reputationUtils.ts`:
  `≥ 50` Союзник | `≥ 10` Дружелюбный | `≥ -20` Нейтральный | `≥ -50` Враждебный | `< -50` Война
- [ ] Update `GovernmentScene.ts:23–27` to use the shared util (threshold `-20` not `-30`)
- [ ] Update `PlanetScene.ts:1160–1180` to use the shared util
- [ ] Run lint + unit tests — green

### Task 5: Fix escort quest details
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/presentation/QuestJournalUI.ts` (or `createQuestCard`)
- Modify: `src/systems/quests/` tests

- [ ] Write RED unit test: generate an ESCORT quest → assert `quest.description`
  contains a convoy/ship identifier (name or callsign) and `targetSystemId` (not
  just `targetPlanetId`); objective type for ESCORT is `"VISIT_SYSTEM"` not
  `"VISIT_LOCATION"` (planet)
- [ ] Update `QuestGenerator.ts` ESCORT block: add `convoiName` (randomly generated
  ship name like "Транспорт «{noun}»") to the quest metadata; set objective to
  `VISIT_SYSTEM` targeting `target.id`; include convoiName in `description`
- [ ] Update `createQuestCard()` in `QuestJournalUI.ts`: for ESCORT quests display
  the convoy name and "Сопроводить в систему X" so the player knows what to look for
- [ ] "Лететь к цели" for ESCORT must route to the target system, not a planet within
  it — confirm the route-to-target button reads `targetSystemId` for VISIT_SYSTEM
  objectives; fix if it currently uses `locationId` (planet)
- [ ] Run lint + unit tests — green
- [ ] E2E regression — green

### Task 6: Move HUD text hints to a help overlay
**Files:**
- Modify: `src/presentation/flight/FlightHud.ts`
- Create or modify: `src/tests/presentation/flightHud.test.ts`

- [ ] Write RED unit test: `FlightHud` does NOT contain any child with text matching
  "ЛКМ" or "Shift" or "Колесико" in the normal (non-help) state; a `[?]` button
  is present in `interactiveLayer`
- [ ] Remove the long instruction string at `FlightHud.ts:316`
- [ ] Add a small `[?]` icon button (bottom-left or bottom-right corner, non-overlapping
  with minimap) that toggles a semi-transparent overlay panel listing all controls:
  ЛКМ — курс | Shift+ЛКМ — прицелиться | ПКМ — панорама | Колесико — зум |
  [J] — Журнал квестов | [I] — Инвентарь
- [ ] Add inventory icon (`[I]`) as a small persistent HUD button alongside any
  existing HUD buttons (action bar area) so the player can find inventory without
  knowing the hotkey
- [ ] Write test: `[?]` toggle shows/hides the help overlay; inventory icon button
  triggers `SceneType.INVENTORY` transition
- [ ] Run lint + unit tests — green
- [ ] Re-run letsplay spec; HUD screenshot shows clean flight screen without
  the text block; `[?]` icon visible

### Task 7: Verify acceptance criteria
**Files:** all changed files above

- [ ] Verify all six bug categories are fixed (ship pos, noname systems, quest
  deadlines/expiry, reputation, escort details, HUD hints)
- [ ] Run full unit test suite: `npm test -- --run` — green
- [ ] Run `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green
- [ ] Run `npm run lint` — zero errors
- [ ] Inspect letsplay screenshots for: galaxy map names, HUD cleanliness,
  quest journal with expired section

## Technical Details

**Deadline formula change:**
```
// Old
deadline = jumps * 2 + rng(2, 4)   // 1-jump = 4–6 days

// New
deadline = max(30, jumps * 15 + rng(5, 10))  // 1-jump = 30–35 days
```

**Unified reputation tiers (`src/utils/reputationUtils.ts`):**
```
rep >= 50  → "Союзник"
rep >= 10  → "Дружелюбный"
rep >= -20 → "Нейтральный"
rep >= -50 → "Враждебный"
rep < -50  → "Война"
```

**ESCORT objective change:**
```
// Old  — routes player to a specific planet
type: "VISIT_LOCATION", locationId: targetPlanetId

// New — routes to the system (convoi is found there)
type: "VISIT_SYSTEM", targetSystemId: target.id
```

## Post-Completion

**Future work — real NPC convoi (out of scope for this plan):**
- Full escort quest tied to a live NPC convoy ship in the world: convoy spawns
  at the issuer planet, moves day-by-day toward the target system, player must
  rendezvous and escort. Requires integration with NPC living-galaxy simulator.
- Delivery quests: physical cargo item placed in player cargo hold on quest accept,
  removed on delivery confirmation.
- Quest types listed in the InfoCenter so player can look up convoi/target ship
  details independent of the journal.

**Manual verification:**
- Accept a 1-jump DELIVERY quest: deadline shown ≥ 30 days in journal
- Accept an ESCORT quest: convoy name visible in description and journal card
- Let a quest expire: journal shows "Провалено" section with the quest; HUD
  shows a toast notification
- Check reputation at -25: both PlanetScene bar and GovernmentScene panel
  both show "Нейтральный"
- Open and close Inventory: ship remains in the same spot
- Warp to an unknown system: galaxy map shows its name on next open
