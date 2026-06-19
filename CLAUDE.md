# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Galactic Horizon: Neural Onslaught** — browser-based space RPG/strategy game with local ONNX models for dialogue generation and tactical AI. Built with TypeScript, PixiJS 8, and onnxruntime-web.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint check on src/**/*.ts
npm test             # Run Vitest unit tests (watch mode)
npm test -- --run    # Run unit tests once (CI mode)
npm run test:e2e            # Run Playwright E2E tests (starts dev server on port 5175 automatically)
npm run test:e2e:headed     # E2E with visible browser
npm run test:e2e:debug      # E2E in debug mode
npm run test:e2e:regression # Run regression playtest suite only (fast gate, < 60 s, for CI)
```

**Run single test file:** `npm test -- --run src/tests/pathfinding.test.ts`

**E2E note:** E2E tests start their own dev server on port 5175 (`playwright.config.ts`). Do not rely on a running `npm run dev` instance for E2E.

## TypeScript Configuration

- Strict mode enabled (`strict: true`, `noImplicitAny`, `noUnusedLocals`)
- Path alias: `@/*` → `src/*`
- Target: ES2022, module: ESNext
- `__DEBUG__` global available (true in development)

## Architecture

### Layer Structure (strict dependency direction: top → bottom only)

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Presentation | `src/presentation/` | PixiJS scenes, sprites, rendering, player input |
| Systems | `src/systems/` | GameEngine, AudioManager, trade, dialogue, galaxy generation; sub-modules: `equipment/`, `npc/`, `quests/`, `info/`, `combat/`, `galaxy/`, `trade/` (route scanner + rumor lifecycle) |
| Domain | `src/domain/` | Pure entities (Player, Galaxy, StarSystem) — no PixiJS/ONNX/DOM deps |
| AI/Infrastructure | `src/ai/`, `src/data/` | ONNX inference, Web Workers, IndexedDB, save management |
| Types/Config | `src/types/`, `src/config/` | Shared types, enums, balance constants; `FactionType` replaces old `RaceType` |

### Key Entry Points

- `src/main.ts` — App entry: Service Worker registration, GameEngine initialization
- `src/systems/GameEngine.ts` — Central engine: scene transitions, game loop, save coordination
- `src/presentation/GameScene.ts` — Base scene class: `initialize()`, `update(dt)`, `destroy()`

### ONNX/AI Pipeline

Models load lazily → cached in IndexedDB → inference runs in Web Workers only. Never call `ort.InferenceSession.run()` on main thread — use `ONNXModelRegistry.infer()`.

### Texture Loading

`src/presentation/textures.ts` — `LAZY_PREFIXES` excludes heavy categories from eager boot preload. Current lazy categories: `panoramas/`, `surfaces/`, `planet_maps/`, `star_maps/`, `stars/`, `nebula/`.

**Pattern for lazy categories** (must NOT use synchronous `pickVariant`):
```typescript
const key = pickVariantKey("nebula", prefix, seed);
if (key) {
  const cached = tex(key);
  if (cached) mount(cached);
  else void loadTextureAsync(key).then((t) => { if (t && !this.sceneDestroyed) mount(t); });
}
```
Any new art category with >10 MB total must be added to `LAZY_PREFIXES`.

## Domain & Types
- Domain fields should be `readonly`. Mutation via explicit methods only.
- **Any change to `src/types/index.ts` or `src/domain/**/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break. This includes the АБС ledger types in `src/domain/banking/Ledger.ts` (`Account`/`Posting`/`JournalEntry`/`BankingSnapshot`), mirrored by `Ledger*Schema`/`BankingSnapshotSchema`.

## Money System: the Ledger is Canonical (АБС core-banking)

All in-game credits live in a **double-entry general ledger** (`src/domain/banking/Ledger.ts`) — the authoritative book of record for the in-game core-banking prototype ("АБС", `docs/plans/20260619-abs-core-banking-prototype.md`). `player.credits` is a **read projection** of the player's current-account GL balance (`cur:<playerId>`), rewritten by `bindCreditsProjection` on every `BalanceChanged` event — **not** a directly-mutated field.

- **NEVER write `player.credits ±= x` (or `npc.credits`) directly.** Move money through the bus: call `adjustPlayerCredits(bank, player, signedDelta, counterpartyId, reason)` / `creditNpc(...)` / `transfer(...)` from `src/systems/banking/economy.ts`, which dispatch a balanced `Transfer`. The `BalanceChanged` event writes the new balance back into `player.credits`, so the net delta is identical to the old direct mutation but money now has a real double-entry source/sink. A credit-write added the old way desyncs the projection from the ledger and is **not** caught by a failing test (the `economy.ts` fallback silently direct-mutates `credits` when no bank is wired).
- **`player.credits` is whole-number currency** (`PlayerSchema.credits` is `int()`). EOD interest leaves savings/loan balances fractional, so any move onto a CURRENT account must be whole (`wholeCreditsToCurrent` in `bankSceneView.ts`) — a fractional projected balance throws on reload (`validateSaveState`).
- **Where it lives:** ledger + snapshot in `src/domain/banking/Ledger.ts` (pure domain, no PixiJS/DOM); the typed command/event bus ("универсальная шина") in `src/systems/banking/bus.ts` (one command handler — `setHandler` throws on a second — plus event fan-out + command observers for the visualization); the `BankingService` handler in `src/systems/banking/BankingService.ts`; the economy seam + GL counterparty ids in `economy.ts`; retail savings/loan products in `products.ts`. `GameEngine` owns `bankBus` + `bankingService` and exposes `.bank` (`{bus, service}`) for scenes/systems to thread in.
- **EOD batch:** `GameEngine.advanceGalaxyDay()` dispatches `RunEndOfDay` (accrue interest, cut statements, roll the bank's business date). Idempotent per business date.
- **Persistence:** the ledger snapshot persists via `SaveState.banking` / `BankingSnapshotSchema`. Old saves lack `banking` and migrate by re-seeding the player current account from `credits` on load (idempotent re-seed) — **no save-version bump**.

## Errors & Logging
- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

## Bug Fixing Process (regression-first)

Every bug follows this order — no exceptions:
1. **Reproduce as a red test first** — write a failing regression test (unit test, or E2E in `playtest-regression.spec.ts` for visual/interaction bugs).
2. **Fix until the test goes green.** Do not claim a fix without the test.
3. **Visually verify** UI/rendering fixes via screenshot — green text-level tests are NOT sufficient evidence for visual bugs.
4. If the fix breaks an adjacent test, that's a root-cause signal — re-diagnose instead of patching the other test.

## Equipment System: ShipLoadout is Canonical

**`GearCatalog`/`ShipLoadout` is the single source of truth** for the hull and every derived stat (cargo, slots, weapon damage, speed, HP). The dual-hull unification (`docs/plans/20260616-dual-hull-unification.md`, save **v22→23**) removed the legacy `PlayerShip.modules` 3-slot array, the `HULL_CLASS_SPECS`-backed stat getters, `equipModule`/`unequipModule`, `GameEngine.rehydrateModule`, the `syncShipToHullClass` bridge, and the dead `IEquipmentService` port. All three former feeding flows (combat loot, gear purchases, micromodule crafting) and the `StationScene` hangar panel now read/write the loadout.

- **Slots are category-aware, not a flat total** (`docs/plans/20260616-ship-fitting-hangar-rework.md`). `ShipLoadout.canInstall`/`install` resolve each gear to one of four banks via `slotCategoryFor(gear)`: weapon (`hull.weaponSlots`), equipment (`hull.equipmentSlots`, shared by fuel tank/shield/droid/scanner/grav-tractor/grapple), engine (1), radar (1). Engine and radar are single dedicated slots — installing a new one **replaces** the fitted part (drops it) rather than stacking or rejecting; the displaced id is surfaced by `loadout.displacedBy(gearId)` so install callers (`installOwnedGear`, `StationScene.buyItem`, combat loot) **re-home it** (warehouse/bag) instead of destroying it. `derivedStats().categories` reports `{used,total}` per bank. The flat `slotsTotal`/`slotsUsed` (still `hull.slots`/`slotted.length`) are legacy and can read `used > total` on a fully-fitted hull — prefer `categories`.
- **Mass budget (МАССА/СВОБОДНО) is a second capacity gate.** Each gear carries `mass` (catalog data on `GearBase`); installed mass sums against `HullSpec.massCapacity`, and `canInstall` rejects an over-mass install **even if a category slot is free** (an engine/radar swap credits the displaced part's mass first). The hull's own frame mass is not counted. `derivedStats()` exposes `massUsed`/`massCapacity`/`massFree`. Mass is catalog-derived from gear ids, so there is **no save migration** (`schemas.ts` untouched).
- **`gearFit(loadout, gearId)`** in `GearBridge` is the canonical structured projection of `canInstall` (`fits` / `no-slot` / `over-mass` / `n/a`) — both the EquipmentShop per-listing hint and `StationScene.explainInstallBlock`'s install-block toast read it; do **not** re-derive fit logic.
- The live `PlayerShip` carries only its in-combat HP/shield/energy pools + a `hullClass` label; these are projected from the loadout via `applyLoadoutHullToShip(ship, loadout)` at hull-change time (both hull shops call it after `loadout.setHull(...)`). Cargo capacity is read through `cargoCapacityOf(loadout)` — no per-ship fallback.
- Hull swaps go through `ShipLoadout.setHull`, which **returns the gear ids it dropped** (gear that no longer fits a smaller hull); callers return those to the inventory bag rather than destroying them. Hangar slot edits use the slot-indexed `removeAt`/`applyMicromoduleAt` (not the by-id variants) so the exact clicked copy is targeted with duplicate gear fitted.
- **Owned-but-uninstalled gear** has a canonical home: `Inventory.ownedGearIds` (catalog gear ids), read **only** through `ownedUninstalledGear(player, loadout)` in `GearBridge` — which returns the store verbatim (it never subtracts installed ids, so an owned *spare* of fitted gear stays sellable). Transitions: `acquireUninstalledGear` (a purchase/loot with no free slot), `installOwnedGear` (owned → loadout), `uninstallToOwned` (loadout → owned). Both the StationScene hangar ТРЮМ and the EquipmentShop ТРЮМ strip consume this one accessor; selling goes through `sellUninstalledGear` (`src/systems/equipment/sellGear.ts`, refund `basePrice × 0.4`). Persisted via `InventorySchema.ownedGearIds` (defaults `[]` for old saves — no save-version bump).
- **Residual (not yet removed):** only the buy-without-a-free-slot path currently feeds `ownedGearIds`. Combat loot (`CombatScene`) and the hangar **unequip** button (`StationScene`) still route into the legacy `inventory.modules` bag via `slotToBagModule` (which preserves the slot's micromodule + artifact-upgrade count — `ownedGearIds` is a bare id list that cannot), so `uninstallToOwned` is wired in tests but **not** in production yet. The bag is also a purchase/remove fallback, and `PlayerShipSchema.modules` stays `.optional()` so pre-v23 saves validate. Remaining cleanup: give `ownedGearIds` rich entries (id + micromodule + upgrades), migrate loot + unequip onto it, and retire the bag.

## Before Every Code Change: Blast Radius Analysis

Before touching any file, run this sequence — no exceptions, no skipping for "small" changes:

1. **`gitnexus impact <Symbol>`** — get the blast radius: which callers, scenes, and tests directly depend on the symbol being changed.
2. **`gitnexus detect_changes`** — if already on a branch with edits, see what's already affected.
3. **`vacuum find_symbol <Symbol>`** — read the full body of what you're about to change.

Then apply the **Pareto filter**: from the blast radius, identify the 20% of touch-points that carry 80% of the risk. Change only those. Leave low-risk dependents untouched unless a test goes red.

**Concrete checklist before each edit:**
- [ ] Blast radius confirmed (impact tool or manual grep)
- [ ] Identified the minimal set of files that must change
- [ ] All other callers verified they don't need updating (or noted why)
- [ ] No refactor bundled into a bug fix — one concern per commit

This rule exists because cascade failures in this codebase typically come from changing a shared utility (e.g. `QuestManager`, `CombatModule`, `GameEngine`) without checking what scenes and systems call it.

## Tooling

Dev helpers (details in `tools/README.md`):
- `vacuum` MCP — `find_symbol`/`find_tests_for`/`get_architecture` — instant body lookup, no index needed
- `gitnexus` MCP — `impact`/`detect_changes`/`context`/`query` — dependency graph, blast radius, semantic search (requires `.gitnexus/` index; re-run `npx gitnexus analyze` after large merges)
- `scaffold/domain-field.ts` — add a field across lockstep files
- `scaffold/new-scene.ts` — register a scene across all 5 files

@.claude/docs/adding-features.md

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **SpaceRangersOnline** (7096 symbols, 26104 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/SpaceRangersOnline/context` | Codebase overview, check index freshness |
| `gitnexus://repo/SpaceRangersOnline/clusters` | All functional areas |
| `gitnexus://repo/SpaceRangersOnline/processes` | All execution flows |
| `gitnexus://repo/SpaceRangersOnline/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
