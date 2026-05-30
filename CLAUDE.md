# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Space Rangers: Neural Onslaught** — browser-based space RPG/strategy game with local ONNX models for dialogue generation and tactical AI. Built with TypeScript, PixiJS 8, and onnxruntime-web.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint check on src/**/*.ts
npm test             # Run Vitest unit tests (watch mode)
npm test -- --run    # Run unit tests once (CI mode)
npm run test:e2e     # Run Playwright E2E tests (starts dev server automatically)
npm run test:e2e:headed  # E2E with visible browser
npm run test:e2e:debug   # E2E in debug mode
```

**Run single test file:** `npm test -- --run src/tests/pathfinding.test.ts`

## Architecture

### Layer Structure (strict dependency direction: top → bottom only)

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Presentation | `src/presentation/` | PixiJS scenes, sprites, rendering, player input |
| Systems | `src/systems/` | GameEngine, combat, trade, dialogue, galaxy generation |
| Domain | `src/domain/` | Pure entities (Player, Galaxy, StarSystem) — no PixiJS/ONNX/DOM deps |
| AI/Infrastructure | `src/ai/`, `src/data/` | ONNX inference, Web Workers, IndexedDB, save management |
| Types/Config | `src/types/`, `src/config/` | Shared types, enums, balance constants |

### Key Entry Points

- `src/main.ts` — App entry: Service Worker registration, GameEngine initialization
- `src/systems/GameEngine.ts` — Central engine: scene transitions, game loop, save coordination
- `src/presentation/GameScene.ts` — Base scene class: `initialize()`, `update(dt)`, `destroy()`

### ONNX/AI Pipeline

Models load lazily → cached in IndexedDB → inference runs in Web Workers only. Never call `ort.InferenceSession.run()` on main thread — use `ONNXModelRegistry.infer()`.

## Critical Coding Rules

### Input Handling (PixiJS)
- **No hardcoded pixel coordinates** for click detection. Use `eventMode = 'static'` + event handlers on interactive objects.
- Position UI in world/relative coordinates, not screen pixels.

### Scene Lifecycle
- `destroy()` must clean up ALL DisplayObjects, intervals, and null out references. Partial cleanup causes memory leaks.
- Scenes cannot access IndexedDB or ONNX directly — route through GameEngine → SaveManager / ONNXModelRegistry.

### Domain & Types
- Domain fields should be `readonly`. Mutation via explicit methods only.
- **Any change to `src/types/index.ts` or `src/domain/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break.

### Errors & Logging
- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

### E2E Testing (Playwright)
- Tests live in `e2e/`, Page Objects in `e2e/page-objects/`.
- **No `canvas.click({ position: {x, y} })`** — use `page.evaluate(() => window.__gameEngine.currentScene.handler())` or accessibility attributes.
- No `waitForTimeout()` — use explicit waits (`waitForFunction`, `waitForSelector`).
- In dev/test mode, `window.__gameEngine` is exposed for test access.

## Adding New Features

### New Scene
1. Create class extending `GameScene` in `src/presentation/`
2. Add `SceneType.MY_SCENE` to `src/types/index.ts`
3. Register in `GameEngine.transitionTo()` switch-case
4. Add Page Object in `e2e/page-objects/` for E2E tests

### New ONNX Model
1. Add config to `src/ai/ModelManifest.ts`
2. Create adapter in `src/ai/adapters/` with `preprocessInput()`, `postprocessOutput()`, `infer()`
3. Implement fallback in `src/ai/FallbackEngine.ts`
4. Add test in `src/tests/`

### New Domain Field
1. Update type in `src/types/index.ts` or `src/domain/*.ts`
2. Update Zod schema in `src/validation/schemas.ts`
3. Add migration in `src/data/MigrationPipeline.ts` if needed

## TypeScript Configuration

- Strict mode enabled (`strict: true`, `noImplicitAny`, `noUnusedLocals`)
- Path alias: `@/*` → `src/*`
- Target: ES2022, module: ESNext
- `__DEBUG__` global available (true in development)

## Project Status

Currently in Phase 0 (Proof of Concept) — ONNX integration, basic flight scene, CI/CD pipeline. Many mechanics have stub implementations.
