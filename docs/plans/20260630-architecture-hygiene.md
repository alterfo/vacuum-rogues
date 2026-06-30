---
# Architecture Hygiene: ECS Removal, Import Cycles, NpcShipManager Split, Layer Docs

## Overview
Four targeted improvements to project architecture hygiene:
1. Delete vestigial `src/ecs/` (47 lines, zero production use) and its lone test.
2. Break the two real import cycles (SceneFactory↔BankScene↔GameEngine, BankingService↔economy) by narrowing concrete-type imports to slim interfaces.
3. Split `NpcShipManager` (2759 lines, 7 responsibilities) — extract `ContactPanelManager` and `LootDropHandler` so the file shrinks to a focused orchestrator.
4. Update CLAUDE.md layer map to document `src/core` ports/adapters layer (8 load-bearing interfaces currently undocumented).

All changes are pure refactors: zero runtime-behaviour change, zero save-schema change, zero new features. The full test suite must stay green (existing assertions untouched) after every task.

## Context
- Key files: `src/ecs/` (dead), `src/core/ports/`, `src/core/DIContainer.ts`, `src/presentation/BankScene.ts`, `src/systems/banking/BankingService.ts`, `src/systems/banking/economy.ts`, `src/core/services/SceneFactory.ts`, `src/presentation/flight/NpcShipManager.ts`
- Existing plan: `docs/plans/20260630-break-import-cycles.md` — Tasks 1–3 are the same as Tasks 2–4 here; that plan is superseded by this one.
- Tests covering NpcShipManager: `src/tests/presentation/npcShipManager.test.ts`, `npcShipDwell.test.ts`, `npcShipClickable.test.ts`, `src/tests/ecs.test.ts` (deleted in Task 1).
- Explore findings: ECS imported only by `src/tests/ecs.test.ts`; DIContainer's `resolve()` called in `main.ts` + `PlanetScene.ts` (lightly used); 24 scenes use `import type { GameEngine }` (systemic coupling, left for later); Cycle 1 back-edge is BankScene→GameEngine; Cycle 5 is BankingService↔economy.
- Related: `docs/plans/20260630-break-import-cycles.md` (superseded), Task 6 in session task list.

## Development Approach
- **Testing approach**: Regular (code first, verify nothing breaks)
- Each task is independently committable and safe to stop after
- **CRITICAL: never modify existing test assertions** — if a split breaks a test, extract to keep the test's import path valid
- Validate after every task: `npm test -- --run && npm run lint && npx tsc --noEmit`
- Blast radius check (`gitnexus impact`) before editing any existing symbol

## Implementation Steps

### Task 1: Delete vestigial src/ecs dead code

**Files:**
- Delete: `src/ecs/Component.ts`, `src/ecs/Entity.ts`, `src/ecs/ECSWorld.ts`
- Delete: `src/tests/ecs.test.ts`

- [x] Confirm nothing in `src/` (outside tests) imports from `src/ecs/` — run `grep -r "from.*['\"].*ecs" src/ --include="*.ts" -l | grep -v tests`; expect empty output
- [x] Delete `src/ecs/Component.ts`, `src/ecs/Entity.ts`, `src/ecs/ECSWorld.ts`
- [x] Delete `src/tests/ecs.test.ts` (its sole purpose was testing the now-deleted code)
- [x] `npm test -- --run && npm run lint && npx tsc --noEmit` — all green

### Task 2: Decouple BankScene from the concrete GameEngine type (Cycle 1)

**Files:**
- Create: `src/presentation/BankSceneHost.ts`
- Modify: `src/presentation/BankScene.ts`

- [ ] Read `src/presentation/BankScene.ts` and list every member of `GameEngine` it accesses (audit all `this.gameEngine.` call sites)
- [ ] Create `src/presentation/BankSceneHost.ts` — a minimal interface exposing only those members (e.g. `audio`, `bank`, `getPlayer()`, `transitionTo()`); no imports from `GameEngine`
- [ ] In `BankScene.ts` replace `import type { GameEngine }` with `import type { BankSceneHost }` and update the constructor/field type — no call-site change in `SceneFactory.ts` needed (real `GameEngine` structurally satisfies the interface)
- [ ] `npx tsc --noEmit` clean — confirms structural compatibility
- [ ] `npm test -- --run && npm run lint` — all green

### Task 3: Decouple economy.ts from the concrete BankingService type (Cycle 5)

**Files:**
- Modify: `src/systems/banking/economy.ts`

- [ ] Read lines around `import type { BankingService }` in `economy.ts` (line 5); identify every use of `BankingService` type in that file
- [ ] If used only as a narrow seam (a couple of methods), replace the `import type { BankingService }` with a local inline interface (e.g. `BankLike`) covering only those members — no change to `BankingService.ts`
- [ ] Confirm `BankingService` still satisfies the narrowed type structurally (`npx tsc --noEmit`)
- [ ] `npm test -- --run && npm run lint` — all green

### Task 4: Re-index and verify cycle reduction

**Files:**
- Modify: `docs/plans/20260630-break-import-cycles.md` (mark superseded)

- [ ] Run `node .gitnexus/run.cjs analyze` to refresh the dependency graph
- [ ] Run gitnexus `check` tool — assert cycle count dropped from 5 to 3 and the 3 remaining are Galaxy↔Overmind, Market↔Planet, Quest↔types (all `import type` only)
- [ ] Mark `docs/plans/20260630-break-import-cycles.md` as superseded (add a one-line note at the top: "Superseded by docs/plans/20260630-architecture-hygiene.md Tasks 2–4")
- [ ] `npm test -- --run` — green

### Task 5: Extract ContactPanelManager from NpcShipManager

**Files:**
- Create: `src/presentation/flight/ContactPanelManager.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/presentation/contactPanelManager.test.ts`

- [ ] Read `NpcShipManager.ts` lines 1511–1640 (the `closeNpcContactPanel` / contact-panel open/close cluster) and identify all state and methods that belong to contact-panel management (`npcContactPanel` field, open/close/hasOpenModal methods, the `NpcContactPanel` import)
- [ ] Create `src/presentation/flight/ContactPanelManager.ts` — class with: `open(npc, deps)`, `close()`, `hasOpenModal(): boolean`, `closeModals()`; owns the `NpcContactPanel` instance; accepts a narrow `ContactPanelDeps` interface (renderer, gameEngine seam, i18n, callbacks) — no import of concrete `NpcShipManager`
- [ ] In `NpcShipManager` replace the inline contact-panel state/logic with a `private panels: ContactPanelManager` field; forward all call sites (`this.closeNpcContactPanel()` → `this.panels.close()` etc.)
- [ ] Write `src/tests/presentation/contactPanelManager.test.ts` — unit tests for open/close lifecycle and `hasOpenModal` state transitions (mock the NpcContactPanel constructor)
- [ ] Verify existing tests still pass: `npm test -- --run` — no regressions in `npcShipManager.test.ts`, `npcShipClickable.test.ts`
- [ ] `npm run lint && npx tsc --noEmit` — clean
- [ ] Run `wc -l src/presentation/flight/NpcShipManager.ts` — line count must have decreased; record new count

### Task 6: Extract LootDropHandler from NpcShipManager

**Files:**
- Create: `src/presentation/flight/LootDropHandler.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/presentation/lootDropHandler.test.ts`

- [ ] Read `NpcShipManager.ts` lines 1156–1460 (`spawnLootForNpc`, `handleInFlightDeath` loot path, `updateLoot`, `applyLootPickup`) and identify the loot-specific state (`spaceLoot` array, `LOOT_TTL_MS` constant, loot pickup radius) and all helpers it imports (`pirateSalvageAmount`, `GearBridge`, `GearCatalog`, `acquireUninstalledGear`, `gearIdForToken`, etc.)
- [ ] Create `src/presentation/flight/LootDropHandler.ts` — class owns `spaceLoot: SpaceLootItem[]`, methods: `spawn(npc, x, y, rng)`, `update(dt)`, `collectIfInRange(shipX, shipY, deps): SpaceLootItem[]`; accepts a narrow `LootDeps` interface (player, bank, loadout accessors — no concrete GameEngine)
- [ ] In `NpcShipManager` replace the inline loot state/methods with a `private loot: LootDropHandler` field; expose `spaceLoot` as a getter forwarding to `this.loot.spaceLoot` (so external readers like `SpaceFlightScene` still work)
- [ ] Write `src/tests/presentation/lootDropHandler.test.ts` — unit tests: spawn creates items at correct position; TTL expires items; pickup within radius collects and removes; pickup outside radius leaves items
- [ ] `npm test -- --run` — no regressions in existing npcShipManager tests
- [ ] `npm run lint && npx tsc --noEmit` — clean
- [ ] Run `wc -l src/presentation/flight/NpcShipManager.ts` — must be < 2200 lines (target reduction from 2759)

### Task 7: Update CLAUDE.md architecture layer map

**Files:**
- Modify: `CLAUDE.md`

- [ ] Add `src/core/` to the Layer Structure table in CLAUDE.md: between Systems and Domain — `src/core/ports/` defines narrow interfaces (ISaveService, IGalaxyService, IPlayerService, IExceptionHandler, IQualityProfile, ISceneFactory, IQuestService), `src/core/adapters/` provides concrete adapters, `src/core/services/SceneFactory.ts` maps SceneType to scene instances; may depend on Systems and Domain; Presentation and Systems may depend on it
- [ ] Add `src/i18n/`, `src/utils/`, `src/validation/`, `src/exceptions/` as documented cross-cutting modules (not a strict layer, used by any layer)
- [ ] Remove the stale `onnxruntime-web` / ONNX references from the AI/Infrastructure layer description (ONNX was removed — see pure-TS MLP plan)
- [ ] `npm test -- --run` — green (no code change, documentation only)

### Task 8: Verify acceptance criteria

- [ ] `npm test -- --run` — full unit suite green, no regressions
- [ ] `npm run lint` — clean
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:playtest` — real-engine gate green
- [ ] `wc -l src/presentation/flight/NpcShipManager.ts` — confirm < 2200 (down from 2759)
- [ ] `grep -r "from.*['\"].*ecs" src/ --include="*.ts"` — empty (ECS fully removed)
- [ ] gitnexus cycle count = 3 (only type-only accepted cycles remain)

## Technical Details

**Cycle 1 break (BankScene):** `BankSceneHost` interface lists only the members BankScene actually calls. `GameEngine` already structurally satisfies it (no casting needed). `SceneFactory.ts` passes the real `GameEngine` unchanged.

**Cycle 5 break (economy.ts):** `BankLike` inline interface has ~2 methods. `BankingService` satisfies it structurally. No change to `BankingService.ts`.

**ContactPanelManager contract:** The `NpcContactPanel` constructor currently receives scene-level callbacks (onClose, onAttack, etc.). These become the `ContactPanelDeps` members — thin lambdas passed from NpcShipManager, so NpcShipManager stays the orchestrator for combat/tribute actions.

**LootDropHandler contract:** `spaceLoot` is currently read by `SpaceFlightScene` (radar dot + pickup). The getter forwarding approach keeps external API identical without changing SpaceFlightScene.

**NpcShipManager after Tasks 5+6:** Becomes a focused orchestrator for NPC sprite lifecycle, AI ticking, combat delegation, and NPC-vs-NPC resolution. The god-object pattern is broken without changing any observable behaviour.

## Post-Completion

**Manual spot-check (optional):**
- Launch game at localhost:5174, click an NPC to open contact panel → close → verify no visual regression
- Kill an enemy NPC → loot drops and can be picked up → verify no regression

**Future work (out of scope here):**
- GameEngine.ts (2157 lines) — extract SceneOrchestrator and DayAdvancer
- NpcSimulator.ts (1926 lines) — extract garrison seeding from daily simulation
- SpaceFlightScene.ts (1897 lines) — already at the guard; extract camera controller coupling
- Wire remaining DIContainer ports (IGalaxyService, IPlayerService, etc.) — separate plan if needed
