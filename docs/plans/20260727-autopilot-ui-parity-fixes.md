# Autopilot/Player UI Parity Fixes

## Overview

An audit (2026-07-27) of `src/tests/playtest/letsplay/` against the real UI in
`src/presentation/` found that the dev/live autopilot and the headless
letsplay harness do not always see — or resolve — the same modals/overlays a
real player does. Four concrete gaps, ranked by risk:

1. **Blocking-modal gap (real stall risk):** `installAutopilotHook.ts`'s
   `tick()` mirrors the quest journal, accessibility panel, and planet-info
   panel as blocking surfaces it must auto-dismiss (with a one-tick grace so a
   human's own click isn't stomped) — but never checks the in-flight system
   menu (`FlightHud.isSystemMenuOpen()`/`isSystemModalOpen()`), which the real
   engine (`SpaceFlightScene.isBlockingModalOpen()`) *does* treat as blocking.
   If it's ever open when the live autopilot ticks, the autopilot sits idle
   behind it forever.
2. **OVERMIND-core boss prompt always "retreats":** `dismissBlockingModal()`'s
   generic `npcManager.closeModals()` branch closes the OVERMIND-core prompt
   exactly like clicking «Отступить» — «Атаковать ядро»
   (`spawnOvermindCoreCombatant()`, the real win-condition fight) is never
   invoked anywhere in `letsplay/`.
3. **Pirate shakedown hail always declined:** the same generic branch closes
   the shakedown panel without ever calling the real
   `onPayTribute`/`onFleeShakedown`/`onAttackNpc` handlers it offers.
4. **Economy/hangar actions bypass the real UI:** `openTrade`, `repair`,
   `buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`, `repay-loan` all
   mutate state through lower-level domain seams directly, never opening
   `TradeScene`/`HangarPanel`/`BankScene`. The `openTrade` bypass is
   *documented* as working around a real gap: the live `executeTrade()` seam
   (`installAutopilotHook.ts:749-751`) is a stub no-op ("No live market
   executor yet"), so if `TradeScene` were opened today the policy's `trade`
   action would do nothing and the agent would loop
   PLANET→TRADE→FLIGHT→PLANET without ever buying/selling. This is a missing
   live executor, not a scene-wiring bug — `TradeScene.e2eBuyItem` (line 624)
   already exists as the precedent seam to extend.

This plan closes all four, in ascending risk order, so each task's tests gate
before the riskier next one starts.

**Explicitly out of scope** (not touched by this plan): `InventoryScene`,
`GovernmentScene` (`liberate` stays a direct `engine.liberateCurrentSystem()`
call), `InfoCenterScene`, `TextQuestScene`, `DialogueScene`, `SaveLoadScene`,
`MainMenuScene`. These are lower-risk domain-only bypasses or scenes the
autopilot never visits at all — a separate future plan if they become worth
covering.

## Context (from discovery)

- Files/components involved:
  - `src/tests/playtest/letsplay/installAutopilotHook.ts` — `dismissBlockingModal()` (`:199-313`), `tick()`'s mirror block (`:317-395`), `openTrade` (`:696-747`), `executeTrade` (`:749-751`)
  - `src/presentation/flight/FlightHud.ts` — `isSystemMenuOpen`/`isSystemModalOpen` (`:465`,`:474`), `closeSystemMenu`/`closeSystemMenuConfirm` (`:1292`,`:1279`)
  - `src/presentation/flight/OvermindBossController.ts` — `isOpen` (`:51`), `spawnOvermindCoreCombatant` (forwarded via `NpcShipManager.ts:1389`), attack/retreat buttons (`:187-215`,`:217-242`)
  - `src/presentation/flight/NpcShipManager.ts` — `hasOpenModal`/`closeModals` (`:670-676`,`:704-708`), `onPayTribute`/`onFleeShakedown`/`onAttackNpc` forwards (`:1273`,`:1278`,`:1287`), `contactNpcId` (private, `:177-179`)
  - `src/presentation/flight/NpcInteractionController.ts` — `openShakedownHail` (`:202-221`, passes `"pirate-shakedown"` context), `onPayTribute`/`onFleeShakedown`/`onAttackNpc` (`:234+`,`:266`,`:458`)
  - `src/presentation/flight/ContactPanelManager.ts` — `open(npc, callbacks, inRange, scanPower, context?)` (`:34-51`), no public context getter yet
  - `src/presentation/TradeScene.ts` — `trade(resource, isBuy)` (`:426`, private), `e2eBuyItem` (`:624-629`, existing e2e precedent)
  - `src/systems/quests/...` job-board fix (`installAutopilotHook.ts:752-778`, `takeQuest()`) is the model to copy: drive the real e2e seam when available, fall back to the domain call for headless doubles.
- Related patterns found: the `e2eOpenJobBoard`/`e2eAcceptBoardQuest`/`e2eCloseJobBoard` convention (`PlanetScene.ts:1657-1670`) is the established shape for "drive the real button handler, not a bypass". The quest-journal/settings-panel grace-flag pattern (`tickCount`, per-panel `*GraceGiven` bool) in `tick()` is the established shape for "don't stomp a human's own click".
- Dependencies identified: `MemoryHeuristicPolicy`'s existing hull-fraction/battle-ready signals (`isBattleReady`, threat-tier hull thresholds already used for the OVERMIND-front-avoidance branch) are reused for the boss-prompt policy — no new threat arithmetic.

## Development Approach

- **Testing approach**: TDD — a red test reproducing the current gap/bug first, then the fix, for every task.
- Complete each task fully (tests green) before moving to the next.
- Follow **Blast Radius Analysis** (CLAUDE.md): run `gitnexus impact` on `dismissBlockingModal`, `NpcShipManager.hasOpenModal`/`closeModals`, and `TradeScene` before editing; this file is dev-only (`src/tests/`) except for the small `NpcShipManager`/`ContactPanelManager`/`TradeScene` additive getters/seams in `src/presentation/`, which are additive-only (new public methods, no signature changes to existing ones) to keep risk low.
- No domain/schema/save changes anywhere in this plan — every fix is presentation-layer wiring or dev-only autopilot logic.

## Testing Strategy

- **Unit/real-engine playtest tests**: `src/tests/playtest/letsplay/installAutopilotHook.test.ts` (existing home for `dismissBlockingModal`/`tick()` coverage) gets new cases per task.
- **Presentation unit tests**: `src/presentation/flight/*.test.ts` / `src/presentation/TradeScene.test.ts` for the new additive getters/seams.
- **Gate**: `npm run test:playtest`, `npm run letsplay:ci` (with `LETSPLAY_CI_SESSIONS=10` for a wider sweep per the recent manual run), and the full unit suite before the final task.

## Implementation Steps

### Task 1: Close the in-flight system-menu blocking-modal gap
- [x] Add a `systemMenuGraceGiven` flag alongside the existing `questJournalGraceGiven`/`settingsPanelGraceGiven`/`planetInfoGraceGiven` in `installAutopilotHook.ts` (`:163-165`)
- [x] In `tick()`, after the planet-info block resets (`:379`) and before the pending-warp handling (`:380+`), add a mirrored grace-gated check: if `hud.isSystemModalOpen()` is true, apply the same `tickCount <= 1 || systemMenuGraceGiven` due-check as the planet-info block, then call `hud.closeSystemMenu()` (not the bulk `closeModals()` — the system menu is a separate registry, confirmed at `FlightHud.ts:592-600` which never touches it)
- [x] Write a regression test in `installAutopilotHook.test.ts`: a stale-open system menu on the controller's first-ever tick closes immediately (`tickCount <= 1`, no grace — mirrors the existing planet-info stale-leftover case)
- [x] Write a regression test: a system menu that *opens* mid-session survives one tick (grace), then closes on the next tick if still open — mirrors the existing quest-journal grace test shape
- [x] Run `npm run test:playtest` — must pass before Task 2

### Task 2: OVERMIND-core boss prompt — real attack/retreat decision
- [x] Add a public `get isOvermindPromptOpen(): boolean { return this.overmind.isOpen; }` getter to `NpcShipManager` (sibling of the existing `isContactPanelOpen`/`isEncounterPromptOpen` getters, `:694`/`:679`) — additive, no existing signature touched
- [x] In `installAutopilotHook.ts`'s `dismissBlockingModal()`, split the current generic `hasOpenModal()` branch (`:283-304`): check `scene.npcManager.isOvermindPromptOpen` **first** (before the generic `hasOpenModal()` check, since `hasOpenModal()` also covers this surface), and instead of `closeModals()`, decide attack vs. retreat by reusing `MemoryHeuristicPolicy`'s existing battle-ready + hull-fraction signals (`isBattleReady(obs)` and the hull threshold already used by the OVERMIND-threat-avoidance branch in `decideWithMemory`) — call `scene.npcManager.spawnOvermindCoreCombatant()` when battle-ready and hull is healthy, else fall through to the existing `closeModals()` retreat path
- [x] Write a regression test: with a mocked `isOvermindPromptOpen: true` and battle-ready+healthy-hull observation, `dismissBlockingModal()` calls `spawnOvermindCoreCombatant()`, not `closeModals()`
- [x] Write a regression test: with the prompt open but NOT battle-ready (or hull hurt), it still retreats via `closeModals()` (locks the existing safe-default behavior)
- [x] Run `npm run test:playtest` — must pass before Task 3

### Task 3: Pirate shakedown hail — real pay/attack/flee decision
- [x] Add a public context getter to `ContactPanelManager` (e.g. `get context(): CommsContext | undefined`, alongside the existing `openNpcId` getter, `ContactPanelManager.ts:26-28`) exposing the `context` param already threaded through `open()` (`:34-51`) — additive
- [x] Expose it + the NPC id through `NpcShipManager` (e.g. a public `get openContactNpc(): { npc: NpcShip; context: CommsContext | undefined } | null`, or thread the existing private `contactNpcId` getter public) so the autopilot can tell a shakedown hail apart from a regular contact panel
- [x] In `dismissBlockingModal()`, before the generic `hasOpenModal()` branch, add a check for `context === "pirate-shakedown"`: reuse the existing hull-fraction/threat signal (same one already driving flee-vs-fight elsewhere in `decideWithMemory`) to choose between `scene.npcManager.onAttackNpc(npc)` (healthy/battle-ready), `scene.npcManager.onFleeShakedown(npc)` (fast/damaged), or `scene.npcManager.onPayTribute(npc)` (affordable and neither of the above) — falls through to the existing `closeModals()` + `e2eStartTurn()` re-arm path only if none of the three apply (e.g. npc/context unavailable, headless double without these methods)
- [x] Write a regression test per branch (attack/flee/pay) asserting the correct handler is called with the right npc
- [x] Write a regression test confirming the pre-existing `e2eStartTurn()` re-arm still fires when the fallback path is taken (no regression on the existing frozen-turn fix)
- [x] Run `npm run test:playtest` — must pass before Task 4

### Task 4: Diagnose and fix the TRADE-scene loop bug, then route trade through the real UI
- [x] Write a **red** test first that reproduces today's gap: drive the live scene through `goTo(SceneType.TRADE, ...)` with `executeTrade()` as currently stubbed, and assert cargo/credits are unchanged after a `trade` action — proving the no-op (documents the bug before touching it)
- [x] Add `e2eSellItem(resource, qty)` to `TradeScene.ts`, mirroring the existing `e2eBuyItem` (`:624-629`) exactly (same `trade(resource, isBuy)` private call, `isBuy=false`)
- [x] Implement the live `executeTrade()` in `installAutopilotHook.ts` (`:749-751`): when the current scene is `TRADE` and exposes `e2eBuyItem`/`e2eSellItem`, compute the same buy/sell decision `openTrade`'s domain-bypass branch already computes (quest cargo need first, else best known margin — reuse the existing helper functions, don't re-derive) and call the real e2e seam with the resolved resource+qty
- [x] Change `openTrade` to actually `goTo(SceneType.TRADE, {...})` instead of calling `executeMemoryAwareTrade` directly, driving the real buy/sell through the just-opened `TradeScene` seams and then leaving back to `SPACE_FLIGHT` (shared `runLiveTrade` helper used by both `openTrade` and the LiveApplier's scene-aware `executeTrade` fallback). Leaving the market after each trade is what breaks the land↔trade spin — mirrors the headless applier's `goTo(...)`-after-trade in `PlayerAgent.ts:400`
- [x] Turn the red test green; add a companion regression test proving the PLANET→TRADE→FLIGHT round trip actually changes cargo/credits when a profitable trade is available
- [x] Run `npm run test:playtest` and `LETSPLAY_CI_SESSIONS=10 npm run letsplay:ci` — must pass (0 errors/soft-locks/violations) before Task 5

### Task 5: Route hangar actions (repair/buy-gear/upgrade-hull/buy-module) through the real HangarPanel
- [ ] Add e2e seams to `HangarPanel`/`StationScene` (or reuse existing ones if `gitnexus impact`/`vacuum find_symbol` turns up any) mirroring the `e2eOpenJobBoard`/`e2eAcceptBoardQuest`/`e2eCloseJobBoard` convention: open the panel, perform the specific action (repair / buy cheapest gear / trade-in hull upgrade / buy micromodule), close it
- [ ] Change `executeRepair`/`executeBuyBestGear`/`executeUpgradeHull`/`executeBuyBestModule` (`equipmentQueries.ts`) to drive the real seam when the current scene exposes it (mirroring `takeQuest()`'s "seam when available, else domain fallback" shape), falling back to the existing direct domain call for headless test doubles
- [ ] Write regression tests per action confirming the real panel path is exercised when present, and the existing domain-only behavior is unchanged when it isn't (locks backward compatibility for existing tests, per the "never touch existing tests" rule)
- [ ] Run `npm run test:playtest` — must pass before Task 6

### Task 6: Route bank actions (take-loan/repay-loan) through the real BankScene
- [ ] Add an e2e seam to `BankScene` for take-loan/repay-loan, same convention as above
- [ ] Change `executeTakeLoan`/`executeRepayLoan` (`bankingQueries.ts:54-86`) to drive the real seam when available, falling back to the existing direct `takeLoan`/`repayLoan` bank-bus calls otherwise
- [ ] Write regression tests confirming both the real-seam and fallback paths
- [ ] Run `npm run test:playtest` — must pass before Task 7

### Task 7: Verify acceptance criteria
- [ ] Verify every gap in the Overview is closed: system menu, OVERMIND-core, shakedown hail, trade/hangar/bank all drive real UI/decision paths where feasible
- [ ] Run the full unit suite (`npm test -- --run`)
- [ ] Run `npm run test:playtest`
- [ ] Run `LETSPLAY_CI_SESSIONS=10 npm run letsplay:ci` — 0 errors/soft-locks/invariant-violations, ≥0.8 survival rate (existing `DEFAULT_CI_THRESHOLDS`)
- [ ] Run `npm run letsplay:campaign` (env-gated long-horizon) if time budget allows, to confirm the OVERMIND-core attack path doesn't regress campaign pacing/win-rate
- [ ] Run `npm run lint` — all issues fixed
- [ ] Run `npm run test:e2e:regression`

### Task 8: Update documentation
- [ ] Update `.claude/docs/systems/letsplay.md`'s "Live controller" and `dismissBlockingModal` sections to describe the new system-menu mirror, the OVERMIND-core/shakedown real-decision branches, and the live trade executor
- [ ] Note in the same doc that `TradeScene`/`HangarPanel`/`BankScene` are now exercised by the autopilot (updates the "economy heads bypass the UI" caveat if still present anywhere)

## Technical Details

- **No new persisted state** — every change here is either dev-only (`src/tests/playtest/letsplay/`) or an additive presentation-layer getter/e2e-seam method (same shape as the existing `e2eOpenJobBoard`/`e2eBuyItem` family). No `src/types/index.ts`/`src/domain/**` field changes, so no `src/validation/schemas.ts` or `MigrationPipeline` touch.
- **Decision policy reuse, not new arithmetic**: Tasks 2 and 3's attack/retreat/pay/flee/attack choices reuse `MemoryHeuristicPolicy`'s existing hull-fraction and `isBattleReady` signals — this plan does not invent new threat math.
- **Grace-flag pattern for Task 1**: copy the exact shape of `planetInfoGraceGiven` (`tickCount <= 1` ⇒ stale-leftover, close immediately; else grant one tick's grace) rather than inventing a new mechanism.
- **`e2e*` naming convention**: every new presentation-layer seam should be named `e2eXxx` and kept public (mirrors `PlanetScene.e2eOpenJobBoard` / `TradeScene.e2eBuyItem`) so it's usable from both this autopilot code and any Playwright E2E test that needs the same deterministic hook.

## Post-Completion

**Manual verification**:
- Live-session eyeball check via `npm run dev` + backtick autopilot: confirm the system-menu grace doesn't visibly flicker for a human who opens `[МЕНЮ]` then re-engages the autopilot.
- Watch one full OVERMIND-core encounter live to confirm the attack decision reads sensibly (ship actually fights instead of endlessly retreating once battle-ready).

**Follow-up (explicitly out of scope here)**:
- `InventoryScene`/`GovernmentScene`/`InfoCenterScene`/`TextQuestScene`/`DialogueScene` UI-parity, if a future audit decides it's worth the cost.
