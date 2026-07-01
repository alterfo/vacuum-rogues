# Refactor NpcShipManager & GameEngine — extraction + smell decoupling

## Overview

Two god objects dominate the codebase and both are high-risk hubs:

- **`src/presentation/flight/NpcShipManager.ts`** (2580 lines) — CRITICAL risk (implements `NpcSimulator`/`FlightModule`; ~34 call sites in `SpaceFlightScene`, ~45 test construction sites). Four independent sub-systems are fused into one class.
- **`src/systems/GameEngine.ts`** (2157 lines) — HIGH risk (26 direct callers; `.gameEngine` referenced 626×). Contains three 180–233-line god methods, plus a **layer violation**: it imports `{ Graphics, Text } from "pixi.js"` (line 23) and builds modal UI, even though `systems/` must never depend on the `presentation/` layer above it.

**Goal (agreed):** behavior-preserving **extraction** that also **decouples two concrete smells**: (a) the bidirectional GameEngine↔NpcShipManager transient-state coupling, and (b) PixiJS UI living in the `systems/` layer. Do **NpcShipManager first**, then GameEngine.

**Key benefits:** each class becomes a thin coordinator delegating to focused, independently-testable units; the `systems/`→`presentation/` layer violation is removed via a narrow port; the update/day-tick god methods shrink to readable orchestration.

**Integration:** all external call sites keep working — the two classes keep their public method surface and forward to the new units (mirroring the existing `ContactPanelManager`/`LootDropHandler`/`ShipDeathFxRenderer` delegation the manager already uses).

## Context (from discovery)

### Files/components involved
- **Primary:** `src/presentation/flight/NpcShipManager.ts`, `src/systems/GameEngine.ts`
- **New units (Phase 1, NpcShipManager):** `NpcInteractionController`, `CombatPursuitController`, `EncounterController`, `OvermindBossController` (all under `src/presentation/flight/`), `FlightSessionState` (under `src/systems/`)
- **New units (Phase 2, GameEngine):** `IOverlayPresenter` port (`src/core/ports/`) + `OverlayPresenter` (`src/presentation/`), `DayTickController`, `EndgameController`, `FlightPositionTracker` (under `src/systems/`)
- **Wiring touch-points:** `src/presentation/SpaceFlightScene.ts` (builds `NpcShipManagerDeps` closure ~234–265; drives manager ~34×), `src/presentation/flight/flightKeyHandler.ts` (Escape close-chain), `src/core/DIContainer.ts` + `src/main.ts` (DI/renderer wiring), `GameEngineDIDependencies` interface (GameEngine.ts:93).

### Constraints the code intelligence surfaced (MUST respect)
1. **`NpcShipManagerDeps` is imported by ~30 test files.** Any change to that interface must be **additive** (new **optional** fields only) — never rename/remove/retype an existing member, or ~30 tests break.
2. **`GameEngineDIDependencies` is constructed at ~28 test sites.** Add the overlay-presenter dependency as **optional** with a headless no-op fallback, so existing DI construction keeps compiling.
3. **`lastFlightShipPos` is read by 13+ files** (SpaceFlightScene, InventoryScene, flightTurnEnd, observe.ts, 8 tests) — it is a de-facto public field. Do **not** relocate it in Phase 1; fold it into `FlightPositionTracker` in Phase 2 behind a backward-compat getter/setter on GameEngine.
4. **Anti-farm fields** (`offeredEncounterIds`, `salvageDay`, `salvagedToday`) are read **only** by GameEngine + NpcShipManager — safe to move into `FlightSessionState` (internal, no external breakage, no save migration — all three are transient/non-persisted).
5. **`SpaceFlightScene.ts < 1900 lines` guard** (`src/tests/flight/moduleContracts.test.ts`) — the deps closure may grow by at most a field or two; watch the line count.
6. **Standing rule: never modify existing tests.** Existing suites are the regression net; only ADD new tests. If an extraction reds an existing test, STOP and re-diagnose (root-cause signal), do not weaken the test.
7. **Layer rule:** `systems/` must not import `presentation/` or `pixi.js`. The GameEngine UI extraction MUST go through a port in `core/ports/`, implemented in `presentation/`, injected via DI — not a direct import.
8. **Money rule:** never touch `player.credits` directly; salvage/tribute paths already route through `banking/economy` — preserve that on extraction.

### Existing delegation to mirror (template pattern)
`ContactPanelManager` (`src/presentation/flight/ContactPanelManager.ts`, ~48 lines): thin class owned via a property (`panels`), constructed with a `deps` bundle, exposing `open`/`close`/`isOpen`/`hasOpenModal`. New controllers copy this exact shape: constructed with a narrow deps bundle, owned as a manager property, methods forwarded 1:1.

## Development Approach

- **Testing approach: Characterization-first (safety net).** The existing extensive suites (`src/tests/core/*`, `presentation/npcShipManager.test.ts`, `flight/chaseSteering.*`, `combat/*`, `npc/*`, `flight/moduleContracts.test.ts`) are the behavior oracle. Keep every one green at every step. For **each newly-extracted unit**, ADD a focused unit test covering its public surface (success + edge/error cases). Do NOT modify existing tests.
- One extraction per task; complete each fully (green suite) before the next.
- Small, focused, mechanical moves: cut a cohesive cluster into a new class, wire the manager/engine to delegate, run tests. No behavior change, no signature change to public methods.
- **Run impact analysis before each extraction** (`gitnexus impact` on the symbols being moved) and `gitnexus detect_changes({scope:"compare", base_ref:"master"})` before each commit to confirm scope.
- Backward compatibility is mandatory (public field/method surface preserved; deps interfaces additive-only).

## Testing Strategy

- **Unit tests:** required for every task — one new `*.test.ts` per extracted unit, exercising its methods directly with a minimal fake deps bundle (copy the fake-deps setup from `npcShipManager.test.ts` / `contactPanelManager.test.ts`).
- **Real-engine playtest:** Phase 2 day-tick/endgame/save extractions lean on `src/tests/playtest/realEngineHarness.ts` consumers and `src/tests/core/*` — run `npm run test:playtest` and the `core/` suite after each Phase 2 task.
- **Save-compat gate:** any task that touches `saveGame`/`loadGame`/persisted `flightShipPos` must run `npm run test:save-compat` and stay green (no schema/migration change is intended — if one becomes necessary, STOP, that is out of scope for a behavior-preserving refactor).
- **Full gate before finishing each phase:** `npm test -- --run`, `npm run lint`, `npm run test:playtest`.
- **E2E:** no new UI is introduced; run `npm run test:e2e:regression` once at the end of each phase to confirm no rendering/interaction regression from the overlay-host move.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix; blockers with ⚠️ prefix.
- Keep this file in sync with actual work; update if scope shifts.

## What Goes Where

- **Implementation Steps** (`[ ]`): code extraction, wiring, new unit tests, running gates — all agent-automatable.
- **Post-Completion** (no checkboxes): visual/manual verification, index refresh, follow-up scope.

---

# PHASE 1 — NpcShipManager (do first)

Order chosen: extract the four sub-systems (most self-contained), then decouple transient state, then slim the `update()` god method last (it delegates into the now-extracted units).

## Implementation Steps

### Task 1: Extract `NpcInteractionController` (contact-panel actions cluster)
- [x] `gitnexus impact({target:"onNpcClick", direction:"upstream", repo:"vacuum-rogues"})` + confirm the cluster's only callers are the manager + ContactPanelManager button callbacks
- [x] create `src/presentation/flight/NpcInteractionController.ts` — mirror `ContactPanelManager` shape (deps bundle + owned by manager)
- [x] move the interaction cluster (~17 methods): `onNpcClick`, `playerCombatStrength`, `playerPirateRep`, `playerIsGoodWithPirates`, `rollShakedown`, `openShakedownHail`, `onPayTribute`, `onFleeShakedown`, `disengagePirate`, `onApproachNpc`, `aimRoute`, `onHailNpc`, `onTradeNpc`, `offerHireContract`, `nearestHostileNpc`, `onAttackNpc`, `npcLeadPoint`
- [x] wire `NpcShipManager` to own `interaction: NpcInteractionController`; keep any manager-level methods referenced by `ContactPanelManager` callbacks / `SpaceFlightScene` forwarding to the controller (no external signature change) — internal callers keep private forwarders (`onNpcClick`/`playerIsGoodWithPirates`/`rollShakedown`/`openShakedownHail`/`aimRoute`/`npcLeadPoint`); the three tested-via-cast entry points (`onPayTribute`/`onFleeShakedown`/`onAttackNpc`) are non-private forwarders (their panel callbacks now live in the controller, so `noUnusedLocals` would flag a private no-caller). Shared pursuit/aim state stays on the manager (Task 2 relocates it) — the controller mutates it via setter callbacks; `NpcShipManagerDeps` unchanged (additive constraint held)
- [x] preserve banking routing (`onPayTribute`/salvage go through `banking/economy`, not `player.credits`) — `payTribute` path moved verbatim; new test asserts credits move via the bank bus
- [x] write `src/tests/presentation/npcInteractionController.test.ts` (hail/trade/attack/approach/shakedown-flee success + edge cases, with a fake deps bundle) — 14 tests
- [x] run `npm test -- --run src/tests/presentation/ src/tests/combat/ src/tests/npc/` — all green before Task 2 (esp. `pirateTributeRep`, `pirateSalvageCredits`, `npcShipManager`) — 1076 passed; `tsc --noEmit` + `lint` clean. (Pre-existing, out-of-scope: `moduleContracts` SpaceFlightScene <1900 guard already red on branch HEAD @1912 lines — untouched by this task. Cyrillic ratchet baseline regenerated: NpcShipManager 41→26, NpcInteractionController +15 = conserved.)

### Task 2: Extract `CombatPursuitController` (combat steering / orbit / chase state)
- [x] `gitnexus impact` on `updateCombat`, `steerCombatOrbit`, `steerTowardLead`; read `flight/chaseSteering.characterize.test.ts` to lock the behavior oracle
- [x] create `src/presentation/flight/CombatPursuitController.ts`; move the chase-steering state fields (`smoothedLead`, `steerTargetId`, `steerStarAvoiding`, `chaseClockMs`, `lastReplotMs`, `lastAimX/Y`, `npcCrossfireTimer`, `pursuitSuspended`, `followNpcId`, `approachNpcId`) plus tuning consts into the controller
- [x] move methods: `launchCombatWithNpc`, `updateCombat`, `breakOffCombatPursuit`, `updateCombatPursuit`, `steerCombatOrbit`, `updateApproach`, `steerTowardLead`, `replotChase`, `leadLineCrossesStar`, `rememberFlightPos`, `nearestNpcEnemy`, `resolveNpcVsNpcCombat`
- [x] keep `NpcShipManager.updateCombat`/`breakOffCombatPursuit`/`followNpcId` as thin forwarders (SpaceFlightScene + flightKeyHandler call these) — `followNpcId`/`pursuitSuspended`/`npcCrossfireTimer` became get/set accessors onto the controller (public — a private accessor with no in-class caller trips `noUnusedLocals`, same fix as Task 1's cast-tested forwarders); `launchCombatWithNpc`/`resolveNpcVsNpcCombat` stayed private forwarders for the existing type-cast tests
- [x] write `src/tests/presentation/combatPursuitController.test.ts` (orbit approach, anti-spin, breakoff, lead-through-star avoidance) — 18 tests
- [x] run `npm test -- --run src/tests/flight/ src/tests/combat/` — all green (esp. `combatOrbit`, `combatOrbitAntiSpin`, `combatBreakoff`, `combatEngagement`, `combatEscape`, `chaseSteering.*`, `targetLostEndsTurn`); full suite 4265 passed (only the pre-existing, out-of-scope `SpaceFlightScene.ts` 1900-line guard stays red, untouched by this task); `tsc --noEmit` + `lint` clean; Cyrillic ratchet baseline regenerated (`UPDATE_CYRILLIC_BASELINE=1`): NpcShipManager 26→25, CombatPursuitController +1 = conserved

### Task 3: Extract `EncounterController` (exploration encounters + own overlay)
- [ ] `gitnexus impact` on `maybeShowEntryEncounter`, `applyEncounterChoice`, `showEncounterPrompt`
- [ ] create `src/presentation/flight/EncounterController.ts`; move `activeEncounter`/`encounterOverlay` state + methods: `maybeShowEntryEncounter`, `rollEntryEncounter`, `applyEncounterChoice`, `encounterOutcomeMessage`, `spawnEncounterAmbush`, `closeEncounterPrompt`, `showEncounterPrompt`, `buildEncounterButton` (+ module consts `ENCOUNTER_PROMPT_COPY`, `encounterOutcomeColor`)
- [ ] keep `NpcShipManager.isEncounterPromptOpen`/`closeEncounterPrompt`/`applyEncounterChoice` as forwarders (flightKeyHandler Escape-chain + SpaceFlightScene depend on these)
- [ ] the encounter overlay stays raw-PixiJS **within this presentation-layer controller** (no port needed — it is already in `presentation/`); consolidate its overlay building here
- [ ] write `src/tests/presentation/encounterController.test.ts` (deterministic roll by (system, day), choice outcomes, prompt open/close)
- [ ] run `npm test -- --run src/tests/playtest/encounters.test.ts src/tests/encounters/` — green

### Task 4: Extract `OvermindBossController` (OVERMIND-core prompt + combatant)
- [ ] `gitnexus impact` on `showOvermindCorePrompt`, `spawnOvermindCoreCombatant`
- [ ] create `src/presentation/flight/OvermindBossController.ts`; move `overmindOverlay` state + `spawnOvermindCoreCombatant`, `showOvermindCorePrompt` (+ `OVERMIND_CORE_ID` usage)
- [ ] keep `NpcShipManager.showOvermindCorePrompt` as a forwarder (SpaceFlightScene calls it)
- [ ] write `src/tests/presentation/overmindBossController.test.ts` (prompt renders, combatant spawns, boss win/loss dispatch)
- [ ] run `npm test -- --run src/tests/presentation/overmindCombat.test.ts src/tests/combat/overmindCoreInflight.test.ts` — green

### Task 5: Decouple transient anti-farm state into `FlightSessionState`
- [ ] confirm via grep that `offeredEncounterIds`/`salvageDay`/`salvagedToday` have no external readers beyond GameEngine + NpcShipManager (verified in discovery — re-confirm before edit)
- [ ] create `src/systems/FlightSessionState.ts` — holds `offeredEncounterIds: Set<string>`, `salvageDay`, `salvagedToday`; intent methods: `hasOfferedEncounter(id)`/`markEncounterOffered(id)`, `canSalvage(day, cap)`/`recordSalvage(day)`, `resetForNewSession()`
- [ ] GameEngine owns a `FlightSessionState` instance; its existing `offeredEncounterIds`/`salvageDay`/`salvagedToday` fields become thin getters delegating to it (keep the day-tick salvage reset in GameEngine's day tick); `generateDefaultGameState` calls `resetForNewSession()`
- [ ] add **optional** `sessionState?: FlightSessionState` to `NpcShipManagerDeps` (additive — do not break the ~30 test importers); `EncounterController` + salvage path read through it, falling back to the GameEngine getters when absent
- [ ] update `SpaceFlightScene` deps closure to pass `sessionState` (watch the 1900-line guard)
- [ ] write `src/tests/systems/flightSessionState.test.ts` (offer-once semantics, salvage cap per day, reset)
- [ ] run `npm test -- --run src/tests/playtest/encounters.test.ts src/tests/combat/pirateSalvageCredits.test.ts src/tests/core/` — green

### Task 6: Slim the `update()` god method (~140 lines → orchestration)
- [ ] `gitnexus impact` on `NpcShipManager.update`; read `combat/npcMovementFreezesOnPause` + `playtest/combatPauseFreezesLiveFight` as the freeze-gate oracle
- [ ] refactor `update()` to delegate per-frame work to the extracted controllers (interaction hover, `CombatPursuitController.tick`, encounter/overmind hooks) + keep loot/deathFx/anchor/depth/despawn inline or in small private helpers; preserve the exact pause-gate ordering
- [ ] preserve `FlightModule` contract (`moduleContracts.test.ts`) and NPC-vs-NPC crossfire timing
- [ ] add characterization test `src/tests/presentation/npcUpdateLoop.test.ts` if a seam is newly exposed (loot-then-behavior-then-crossfire order); otherwise rely on existing pause/freeze suites
- [ ] run `npm test -- --run src/tests/flight/ src/tests/combat/ src/tests/presentation/ src/tests/playtest/` — all green

### Task 7: Phase 1 gate
- [ ] `npm test -- --run` (full unit suite) — green
- [ ] `npm run lint` — clean
- [ ] `npm run test:playtest` — green
- [ ] `npm run test:e2e:regression` — green (no flight rendering/interaction regression)
- [ ] `gitnexus detect_changes({scope:"compare", base_ref:"master"})` — confirm only NpcShipManager + new units + SpaceFlightScene deps closure changed
- [ ] confirm `NpcShipManager.ts` line count materially reduced and `SpaceFlightScene.ts` still < 1900 lines

---

# PHASE 2 — GameEngine (after Phase 1 is green)

## Implementation Steps

### Task 8: Extract PixiJS modal/overlay UI behind `IOverlayPresenter` port (fix layer violation)
- [ ] `gitnexus impact({target:"showGameOutcomeScreen", direction:"upstream", repo:"vacuum-rogues"})` + on `showErrorModal`/`showLoadingOverlay`
- [ ] add `src/core/ports/IOverlayPresenter.ts` (methods: `showError(message, onDismiss?)`, `clearModal()`, `showLoading(text?)`, `hideLoading()`, `showGameOutcome(win, { onNewGamePlus, onRestart, ... })`) + export from `core/ports/index.ts`
- [ ] add `src/presentation/OverlayPresenter.ts` implementing the port, holding the renderer/stage; move the pixi-building bodies of `showErrorModal`, `clearModal`, `showLoadingOverlay`, `hideLoadingOverlay`, `showGameOutcomeScreen` here (+ `modalObjects`/`loadingOverlayObjects` state)
- [ ] add **optional** overlay presenter to `GameEngineDIDependencies` with a **headless no-op fallback** (so ~28 test construction sites keep compiling); wire the real `OverlayPresenter` in `src/main.ts` / `DIContainer` after renderer init
- [ ] **remove `import { Graphics, Text } from "pixi.js"` from `GameEngine.ts`** — GameEngine now calls `this.overlay.showError(...)` etc.
- [ ] write `src/tests/core/overlayPresenter.test.ts` (headless: engine calls route to presenter) + `src/tests/architecture/noPixiInGameEngine.test.ts` guarding that `GameEngine.ts` never imports `pixi.js` (mirror `noOnnxRuntime.test.ts`)
- [ ] run `npm test -- --run src/tests/core/ src/tests/gameOverScene.test.ts src/tests/combat/playerDeath.test.ts` — green

### Task 9: Extract `DayTickController` from `advanceGalaxyDay` (~233 lines)
- [ ] `gitnexus impact({target:"advanceGalaxyDay", direction:"upstream", repo:"vacuum-rogues"})`; identify the day-tick oracle tests (`trade/rumorDailyTick`, `flight/turnDateAdvances`, overmind arc suites)
- [ ] create `src/systems/DayTickController.ts` orchestrating the per-day steps (NPC-sim tick + news, global events, market drift + MARKET_SHIFT news, trade-route rumor lifecycle, droid repair, ownership-equilibrium tick + capture news + floor reseed, Overmind arc spread, endgame outcome dispatch, quest-expiry, EOD banking, win-condition/WIN_SCREEN) — each step already a pure-fn call; controller sequences them over engine state passed in
- [ ] `GameEngine.advanceGalaxyDay` becomes a thin delegator to `DayTickController.run(...)`; win/loss overlay dispatch routes through the Phase-2 `IOverlayPresenter`
- [ ] preserve Overmind invariants (undirected `frontierSystems`, `engaged = lastSpreadDay >= 0`, `freezeOvermind`) and day-order exactly
- [ ] write `src/tests/systems/dayTickController.test.ts` (step ordering, news emission, win-condition trigger) with a fake engine-state bundle
- [ ] run `npm test -- --run src/tests/trade/ src/tests/flight/turnDateAdvances.test.ts src/tests/core/` + overmind suites — green

### Task 10: Extract `EndgameController` (win/loss / New Game+ / death)
- [ ] `gitnexus impact` on `checkWinCondition`, `startNewGamePlus`, `triggerPlayerDeath`, `generateDefaultGameState`
- [ ] create `src/systems/EndgameController.ts` — one-shot guards (`_outcomeShown`, `_winScreenShown`, `_playerDeathShown`, `pendingNewGamePlus`), `checkWinCondition`, `showGameOutcome` (via presenter), `startNewGamePlus`, `triggerPlayerDeath`, `restartNewGame`, `generateDefaultGameState`
- [ ] keep `GameEngine.triggerPlayerDeath`/`showGameOutcomeScreen`/`startNewGamePlus`/`restartNewGame` as forwarders (NpcShipManager + scenes call these); ensure GOD-mode `isDowned` derivation untouched
- [ ] write `src/tests/core/endgameController.test.ts` (one-shot guard, NG+ carry consumption, death dispatch)
- [ ] run `npm test -- --run src/tests/core/ src/tests/combat/playerDeath.test.ts src/tests/gameOverScene.test.ts` — green

### Task 11: Extract `FlightPositionTracker` (flight-position persistence cluster)
- [ ] `gitnexus impact` on `recordLiveFlightPos`, `flushFlightAutosave`, `registerFlightHideAutosave` + note the 13+ external readers of `lastFlightShipPos`
- [ ] create `src/systems/FlightPositionTracker.ts` — owns `flightShipPos` (persisted), `liveFlightShipPos`; methods `forgetFlightPosition`, `recordLiveFlightPos`, `flushFlightAutosave`, `registerFlightHideAutosave`, save/restore of `flightShipPos`
- [ ] keep `gameEngine.lastFlightShipPos` and `gameEngine.liveFlightShipPos` as backward-compat getters/setters delegating to the tracker (13+ external readers — MUST NOT break)
- [ ] **no schema/migration change** — `flightShipPos` save format is byte-identical; run `npm run test:save-compat`
- [ ] write `src/tests/core/flightPositionTracker.test.ts` (record/flush/restore, systemId guard)
- [ ] run `npm test -- --run src/tests/core/ src/tests/data/goldenSaveCompat.test.ts` + `npm run test:save-compat` — green

### Task 12: Phase 2 gate + acceptance
- [ ] verify all Overview goals: both files materially slimmer, layer violation gone (pixi import removed from GameEngine, guard test green), transient coupling decoupled, four+four units extracted with tests
- [ ] `npm test -- --run` (full) — green
- [ ] `npm run lint` — clean
- [ ] `npm run test:playtest` — green
- [ ] `npm run test:save-compat` — green
- [ ] `npm run test:e2e:regression` — green
- [ ] `gitnexus detect_changes({scope:"compare", base_ref:"master"})` — affected scope matches the two files + new units only

### Task 13: [Final] Docs + index refresh
- [ ] update `.claude/docs/systems/letsplay.md` / relevant subsystem docs if the flight/day-tick seams they describe moved
- [ ] note the new controllers in CLAUDE.md's subsystem table if warranted (keep it terse)
- [ ] `node .gitnexus/run.cjs analyze` to refresh the code-intelligence index after the large move

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`.*

## Technical Details

- **Deps-bundle pattern:** each new controller takes a small typed deps interface (a subset of what the manager already has) + owned by the parent as a property; parent methods forward 1:1. This keeps `NpcShipManagerDeps` and the public method surface stable.
- **Port pattern (Task 8):** `IOverlayPresenter` in `core/ports/` (systems may depend on core/ports), concrete impl in `presentation/`, injected via DI — never a `systems/`→`presentation/` import.
- **State ownership after decoupling:** anti-farm state → `FlightSessionState` (GameEngine-owned, manager reads via deps). Flight position → `FlightPositionTracker` (GameEngine-owned, `lastFlightShipPos` stays a compat getter). Endgame guards → `EndgameController`. Day sequencing → `DayTickController`.
- **No persisted-field changes anywhere** — this is a pure structural refactor; if any step appears to require a schema/migration/save bump, STOP and re-scope (out of bounds for behavior-preserving work).

## Post-Completion

*Informational — no checkboxes.*

**Manual verification:**
- Visually confirm in `npm run dev`: contact panel actions, live combat orbit/breakoff, an exploration-encounter prompt, the OVERMIND-core prompt, an error modal, the win/loss screen, and a browser-reload flight-position resume — all behave exactly as before (screenshot the flight scene per the "visual bugs need screenshots" rule).

**Follow-up scope (explicitly deferred — YAGNI):**
- Slimming `transitionTo` (~180 lines) and `loadGame` (~200 lines): higher save/load-correctness risk; extract new-game creation + scene-resume resolution helpers in a **separate** plan, not bundled here.
- Relocating `lastFlightShipPos` off GameEngine entirely (13+ readers) — only if a later change makes it worthwhile.
