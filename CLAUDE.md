# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Galactic Horizon: Neural Onslaught** — browser-based space RPG/strategy game with tiny **pure-TS neural policies** (and a rule-based `FallbackEngine`) for tactical AI and dialogue. Built with TypeScript and PixiJS 8. (`onnxruntime-web` was removed — neural nets are tiny pure-TS MLPs.)

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
npm run test:playtest       # Real-engine playtest suite (pre-push gate, ~3 s)
npm run letsplay            # Dev-only letsplay bug-finder — an agent plays the real engine
npm run letsplay:ci         # Letsplay CI oracle (pre-push + CI gate, ~2.5 s)
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
| Systems | `src/systems/` | GameEngine, AudioManager, trade, dialogue, galaxy generation; sub-modules: `equipment/`, `npc/`, `quests/`, `info/`, `combat/`, `galaxy/`, `trade/`, `onboarding/`, `encounters/` |
| Core / Ports | `src/core/ports/`, `src/core/adapters/`, `src/core/services/`, `src/core/DIContainer.ts` | Narrow port interfaces; `SceneFactory.ts` maps `SceneType` to scene instances; `DIContainer` wires ports to implementations |
| Domain | `src/domain/` | Pure entities (Player, Galaxy, StarSystem) — no PixiJS/DOM deps |
| AI/Infrastructure | `src/ai/`, `src/data/` | Rule-based `FallbackEngine`, IndexedDB, save management; neural policies are pure-TS MLPs |
| Types/Config | `src/types/`, `src/config/` | Shared types, enums, balance constants; `FactionType` replaces old `RaceType` |

**Cross-cutting modules:**
- `src/i18n/` — key-based translation (`t(key, params?)`), RU/EN dictionaries
- `src/utils/` — pure utility functions (font scale, logger, etc.)
- `src/validation/` — Zod save-state schemas (`SaveStateSchema`, `GalaxySchema`, etc.)
- `src/exceptions/` — typed exception classes (`GameBusinessException`, `GameSystemException`, etc.)

### Key Entry Points

- `src/main.ts` — App entry: Service Worker registration, GameEngine initialization, boot gates
- `src/systems/GameEngine.ts` — Central engine: scene transitions, game loop, save coordination
- `src/presentation/GameScene.ts` — Base scene class: `initialize()`, `update(dt)`, `destroy()`

### Subsystem Docs (read when working in these areas)

| Area | File |
|------|------|
| Mobile gate + touch controls | `.claude/docs/systems/mobile-touch.md` |
| Settings panel + i18n | `.claude/docs/systems/settings-i18n.md` |
| Accessibility seams (palette/reduced-motion/keymap) | `.claude/docs/systems/accessibility.md` |
| Save slots UI + Continue resolver | `.claude/docs/systems/save-slots.md` |
| Equipment / ShipLoadout / gear | `.claude/docs/systems/equipment.md` |
| Banking / ledger / АБС | `.claude/docs/systems/banking.md` |
| Overmind arc / spread machine | `.claude/docs/systems/overmind.md` |
| Adaptive audio / music director | `.claude/docs/systems/audio.md` |
| Letsplay engine / autopilot / neural training | `.claude/docs/systems/letsplay.md` |
| Adding features (scenes/assets/i18n/domain fields) | `.claude/docs/adding-features.md` |

### Neural / AI Pipeline (pure-TS, no ONNX runtime)

MLPs run through a **hand-written pure-TS forward pass** (`src/tests/playtest/letsplay/mlp.ts`) over weights shipped as a small JSON array — no worker, no WebGPU, no wasm. `onnxruntime-web` is fully removed; `src/tests/architecture/noOnnxRuntime.test.ts` keeps it out.

- **`FallbackEngine` (`src/ai/FallbackEngine.ts`)** is the canonical rule-based engine for dialogue/tactical AI — pure templates.
- **`NeuralPolicy`** (`src/tests/playtest/letsplay/NeuralPolicy.ts`, dev-only): `featurize → forward → mapNetOutputToAction`. Training: PyTorch (`tools/ai/train_player.py`), exports weights as JSON. Parity test: `weightsContract.test.ts` (within `1e-5`).
- **Neural flag** = a plain feature gate (`isNeuralEnabled()` / `setNeuralEnabled()` in `gameSettings.ts`, default false). Off ⇒ rule-based heuristic; on ⇒ NeuralPolicy. Do NOT re-introduce dynamic `import()` / lazy ONNX.

Current net: `weights/player.weights.json`, 3-layer `50→256→128→16` ≈ 51,328 params. `FEATURE_LENGTH = 50` (OBS=30 + MEMORY=20). Growing either block requires retraining + re-export.

### Texture Loading

`src/presentation/textures.ts` — `LAZY_PREFIXES` excludes heavy categories from eager boot preload. Current lazy: `panoramas/`, `surfaces/`, `planet_maps/`, `star_maps/`, `stars/`, `nebula/`.

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

**Assets are WebP.** New PNG/JPG art must be run through `tools/optimize-assets.ts` before commit. Key-parity is locked by `src/tests/assets/manifestKeys.snapshot.json`.

## Domain & Types

- Domain fields should be `readonly`. Mutation via explicit methods only.
- **Any change to `src/types/index.ts` or `src/domain/**/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break.
- **A new *persisted* domain field** needs a `src/data/MigrationPipeline.ts` migration + `CURRENT_VERSION` bump. Two exceptions (no migration): (a) catalog-derived field the schema already tolerates; (b) optional additive field (mark `.optional()` in schema). Version bump required only when an old save's value must be *defaulted* to something other than "absent".
- **Branching text-quests are catalog data** (`QuestScript`s in `src/systems/quests/scripts/`). Adding one needs no schema/migration/save bump — see `src/systems/quests/scripts/README.md`.

## Save Compatibility: Never Brick a Beta-Tester's Progress

Classify your change and follow the matching rule:

- **Persisted-field change ⇒ migration + a golden save.** Schema + `MigrationPipeline` + `CURRENT_VERSION` bump + refresh fixture in `src/tests/data/goldenSaves/` (`GEN_GOLDEN=1` for current-version).
- **Catalog/`GearCatalog` change ⇒ load revalidation, no migration.** `ShipLoadout.revalidateToCurrentHull()` re-runs eviction; `GameEngine.loadGame` calls it after `fromJSON`.
- **Generation change ⇒ new-games-only, existing saves safe.** Galaxy is persisted via `SaveStateSchema.galaxy`.
- **Gate:** `npm run test:save-compat` (`goldenSaveCompat.test.ts` + `loadoutRevalidateOnLoad.test.ts`, ~2 s). Pre-push via `lefthook.yml` + `.github/workflows/save-compat.yml`.

## Difficulty Modes: God / Normal / Hard

`Player.gameMode` (`GameMode = "GOD" | "NORMAL" | "HARD"`) is a per-run choice. Absent/old saves ⇒ `NORMAL`.

- **GOD**: `src/systems/combat/godMode.ts` is the single source. `applyDamageWithMode(...)` floors hull above 0 in GOD. `isDowned(player)` is *derived* (not persisted). **Route every hull-damage path through `applyDamageWithMode`** and every fire/jump gate through `isDowned`.
- **HARD scaling**: config-only in `src/config/balance.ts` (`DIFFICULTY_HOSTILE_SCALING`). Tune there, never at call sites.

## Overmind Arc (key rules only)

Full details: `.claude/docs/systems/overmind.md`. Critical invariants:
- `frontierSystems` treats the warp graph as **UNDIRECTED** — do not revert to a directed scan.
- Win requires **genuine engagement** (`engaged = state.lastSpreadDay >= 0`) — `peakThreat` is a false proxy.
- `freezeOvermind: true` prevents the equilibrium tick from capping/liberating the Overmind front.

## Money System (key rules only)

Full details: `.claude/docs/systems/banking.md`. Critical rule: **NEVER write `player.credits ±= x` directly.** Use `adjustPlayerCredits`/`creditNpc`/`transfer` from `src/systems/banking/economy.ts`. `player.credits` is whole-number currency.

## Errors & Logging

- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

## Bug Fixing Process (regression-first)

Every bug follows this order — no exceptions:
1. **Reproduce as a red test first** — write a failing regression test (unit test, or E2E in `playtest-regression.spec.ts` for visual/interaction bugs).
2. **Fix until the test goes green.** Do not claim a fix without the test.
3. **Visually verify** UI/rendering fixes via screenshot — green text-level tests are NOT sufficient evidence for visual bugs.
4. If the fix breaks an adjacent test, that's a root-cause signal — re-diagnose instead of patching the other test.

### Three test tiers — pick by bug class

| Tier | Where | Catches | When to use |
|------|-------|---------|-------------|
| **Unit (mocked logic)** | `src/tests/**/*.test.ts` with `Mock*` services / `vi.mock("pixi.js")` | pure logic in isolation | a **pure function / domain rule** is wrong |
| **Real-engine playtest** | `src/tests/playtest/**` — boots the **real** `GameEngine`, stubs only PixiJS | **wiring between real components** (scene transitions, combat, quests, banking) | an **integration/scene/wiring** bug |
| **Playwright E2E** | `e2e/**` (`playtest-regression.spec.ts`) | real rendering + pointer interaction | a **visual/interaction** bug |

**Convention:** integration/scene bugs go in the real-engine playtest harness — **never** a mocked unit test that re-creates the false green by mocking the broken seam. The playtest suite (`npm run test:playtest`, ~3 s) is a pre-push gate.

### Letsplay engine (key facts)

Full details: `.claude/docs/systems/letsplay.md`. `src/tests/playtest/letsplay/` plays the real engine (dev-only). Loop: `observe → decide → apply → tick`. Live autopilot: `` ` `` (Backquote) in `npm run dev`. Default policy: `MemoryHeuristicPolicy`. First human input reclaims control.

## Equipment System (key rules only)

Full details: `.claude/docs/systems/equipment.md`. Key rules:
- `GearCatalog`/`ShipLoadout` is the single source of truth — never compute hull stats elsewhere.
- Never compute `hullHP / ship.maxHull` directly — use `hullStatus(hullHP, shipMaxHull, loadoutMaxHull?)`.
- `gearFit(loadout, gearId)` in `GearBridge` is the canonical fit projection — do not re-derive.
- Owned-but-uninstalled gear lives in `Inventory.ownedGearIds`, read only through `ownedUninstalledGear(player, loadout)`.
- Shared hangar: `src/presentation/ui/HangarPanel.ts` — mounted by both `StationScene` and `EquipmentShopScene` АНГАР tab. Do not fork fit logic into a scene.

## Before Every Code Change: Blast Radius Analysis

Before touching any file, run this sequence — no exceptions, no skipping for "small" changes:

1. **`gitnexus impact <Symbol>`** — get the blast radius: which callers, scenes, and tests directly depend on the symbol being changed.
2. **`gitnexus detect_changes`** — if already on a branch with edits, see what's already affected.
3. **`vacuum find_symbol <Symbol>`** — read the full body of what you're about to change.

Then apply the **Pareto filter**: from the blast radius, identify the 20% of touch-points that carry 80% of the risk. Change only those.

**Concrete checklist before each edit:**
- [ ] Blast radius confirmed (impact tool or manual grep)
- [ ] Identified the minimal set of files that must change
- [ ] All other callers verified they don't need updating (or noted why)
- [ ] No refactor bundled into a bug fix — one concern per commit

## Tooling

Dev helpers (details in `tools/README.md`):
- `vacuum` MCP — `find_symbol`/`find_tests_for`/`get_architecture` — instant body lookup, no index needed
- `gitnexus` MCP — `impact`/`detect_changes`/`context`/`query` — dependency graph, blast radius, semantic search (requires `.gitnexus/` index; re-run `npx gitnexus analyze` after large merges)
- `scaffold/domain-field.ts` — add a field across lockstep files
- `scaffold/new-scene.ts` — register a scene across all 5 files

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **vacuum-rogues** (13910 symbols, 45733 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/vacuum-rogues/context` | Codebase overview, check index freshness |
| `gitnexus://repo/vacuum-rogues/clusters` | All functional areas |
| `gitnexus://repo/vacuum-rogues/processes` | All execution flows |
| `gitnexus://repo/vacuum-rogues/process/{name}` | Step-by-step execution trace |

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
