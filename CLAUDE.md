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
| Systems | `src/systems/` | GameEngine, AudioManager, trade, dialogue, galaxy generation; sub-modules: `equipment/`, `npc/`, `quests/`, `info/`, `combat/`, `galaxy/` |
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
- **Any change to `src/types/index.ts` or `src/domain/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break.

## Errors & Logging
- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

## Bug Fixing Process (regression-first)

Every bug follows this order — no exceptions:
1. **Reproduce as a red test first** — write a failing regression test (unit test, or E2E in `playtest-regression.spec.ts` for visual/interaction bugs).
2. **Fix until the test goes green.** Do not claim a fix without the test.
3. **Visually verify** UI/rendering fixes via screenshot — green text-level tests are NOT sufficient evidence for visual bugs.
4. If the fix breaks an adjacent test, that's a root-cause signal — re-diagnose instead of patching the other test.

## Known Caveat: Legacy Equipment System

**Decision (letsplay F6, 2026-06-10): GearCatalog/ShipLoadout is canonical.** The legacy `ship.modules`/`inventory.modules` system is inert; `InventoryScene` renders a read-only view of the loadout. Full removal requires a save migration — remains open. The legacy system is still **player-visible in `StationScene`'s hangar panel** and fed by three production flows (combat loot, gear purchases, micromodule crafting). Canonicalizing the hangar panel is the open legacy-removal work; it needs its own plan.

@.claude/docs/adding-features.md
