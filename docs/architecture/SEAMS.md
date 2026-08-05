# Seams & Contracts

How the layers touch. Every place `presentation/` → `systems/` → `core` → `domain`
would otherwise couple to a concrete class, there is a **narrow port interface**
(`src/core/ports/`) with a concrete implementation behind it and a **headless
fallback** for tests/production where the real one is absent. `GameEngine` sees
only the interfaces; `DIContainer` (or the constructor) chooses the implementation.

Read alongside [`MODULES.md`](./MODULES.md) (module map + dependency rule),
[`BUSES.md`](./BUSES.md) (the event/command channels), and
[`DATA-FLOW.md`](./DATA-FLOW.md) (the flows that cross these seams).

> **Anchors verified against `047438ef` (2026-07-31).** Symbol names are
> authoritative; `file:line` numbers are a convenience and drift over time.
> The symbols cited here are guarded by `src/tests/architecture/docAnchorsExist.test.ts`
> — rename one and that test reds.
>
> **🔒 = enforced by a test/lint · ⚙️ = enforced at runtime · 📝 = prose only (unenforced).**

## The port catalogue

Each port lives in `src/core/ports/`, is re-exported from `ports/index.ts`, and is
injected into `GameEngine` via `GameEngineDIDependencies`
(`src/systems/GameEngine.ts:96`).

| Port | Concrete impl | Fallback | Wired in | Crosses |
|------|---------------|----------|----------|---------|
| `ISaveService` | `SaveManagerAdapter` → `SaveManager` (IndexedDB) | — (required) | `main.ts:80` | engine → persistence |
| `IGalaxyService` | `GalaxyService` (`core/services/`) | — | `main.ts:81` | engine → generation |
| `IPlayerService` | `PlayerService` (`core/services/`) | — | `main.ts:82` | engine → domain lifecycle |
| `IExceptionHandler` | `ExceptionHandlerAdapter` → `GlobalExceptionHandler` | — | `main.ts:83` | engine → error handling |
| `IQuestService` | `QuestManagerAdapter` → `QuestManager` | test doubles (`Mock*`) | `main.ts:84` | engine → quests |
| `IQualityProfile` | `AdaptiveQualityProfile` | — | `main.ts:162` | engine → perf tuning |
| `IOverlayPresenter` | `OverlayPresenter` (`presentation/`) | `NoOpOverlayPresenter` | `main.ts:169` | **systems → presentation** |
| `IAutopilotStateProvider` | backed by `AutopilotController` (dev-only) | `NoOpAutopilotStateProvider` | `dev/devAutopilot.ts` | **systems → dev-only test tree** |
| `ISceneFactory` | `SceneFactory` (`core/services/`) | — | built inside `GameEngine` | engine → presentation scenes |

The first five are registered on the `DIContainer` singleton in
`initializeDIContainer()` (`src/main.ts:77`) and resolved when the `GameEngine` is
constructed (`src/main.ts:173`). `DIContainer` itself is a thin token→instance map
(`register`/`resolve`/`resolveSingleton`, `src/core/DIContainer.ts`) — no
reflection, no decorators.

## The two “optional port” seams (the pattern to copy)

Two ports exist specifically to keep `systems/` from importing a layer it must not,
and both are **optional** with a no-op fallback so every DI/test site keeps
compiling. This is the canonical recipe named in root `CLAUDE.md`.

### `IOverlayPresenter` — systems → presentation

> 🔒 `src/tests/architecture/noPixiInGameEngine.test.ts` — recursively scans
> `src/systems/**` and fails on any `pixi.js`/`@pixi/*` import, so this seam can't
> be bypassed by pulling PixiJS back into `systems/`.

`GameEngine` needs full-screen modals (error, loading, win/loss) that only PixiJS
(`presentation/`) can draw. Instead of importing `pixi.js` into `systems/`:

- **Interface** `src/core/ports/IOverlayPresenter.ts` — `showError`, `showLoading`
  / `hideLoading`, `showGameOutcome`, `dismissAll`.
- **Impl** `OverlayPresenter` (`presentation/`), constructed *before* the engine
  and reading the renderer back through a closure (`src/main.ts:169`) because the
  renderer doesn't exist until `engine.initialize()`.
- **Fallback** `NoOpOverlayPresenter` — every method is a silent no-op, matching
  the old `if (!this.renderer) return;` early-out. Injected by default in unit
  tests (`GameEngine` uses `?? new NoOpOverlayPresenter()`, `GameEngine.ts:412`).
- **Contract detail:** `dismissAll()` MUST run in `transitionTo` *before* the
  renderer's blanket `clearUILayer()`, or an open overlay's PixiJS objects get
  destroyed out from under the presenter (leaks stale refs across scenes — F4).

### `IAutopilotStateProvider` — systems → dev-only test tree

> 🔒 `src/tests/architecture/letsplayDevOnly.test.ts` — asserts no production
> module (everything under `src/` except `src/tests/**`) statically imports the
> dev-only letsplay tree. The port is the only sanctioned bridge.

The live autopilot lives in `src/tests/playtest/letsplay/` (dev-only) and must not
leak into `systems/`. `GameEngine` only reads `isEngaged()` at save time and calls
`resume(engaged)` at the tail of `loadGame`.

- **Impl** built from the real `AutopilotController`, injected from
  `src/dev/devAutopilot.ts` (reachable only through `main.ts`'s
  `if (import.meta.env.DEV)` dynamic-import chunk), usually via
  `GameEngine.setAutopilotStateProvider` after boot (the hook installs late).
- **Fallback** `NoOpAutopilotStateProvider` — `isEngaged()` always `false` (so no
  save persists a spurious engaged flag), `resume()` a no-op. `resume` must never
  throw: a load must succeed even if re-engage can't.

## The recipe (when you need to cross a layer boundary)

Do **not** import the lower-priority layer directly. Instead:

1. Define a **narrow** interface in `src/core/ports/` — only the methods the caller
   needs, phrased in the caller's terms (not the impl's).
2. Implement it in the layer that owns the capability (`presentation/`, `data/`, …).
3. Add a **headless no-op fallback** in `src/core/adapters/` so every existing DI
   site and unit test keeps compiling.
4. Inject it as an **optional** dependency (`foo?: IFoo`) and default to the no-op
   (`deps.foo ?? new NoOpFoo()`).

This preserves the strict top-down dependency direction from `MODULES.md`:
`contracts ← domain ← {services} ← engine-core ← {presentation, audio}`.

### Enforcement status — read this before trusting the rule

The headline "cross a layer via a port" rule is **partially** enforced. Know exactly
which parts, so you don't assume a guard that isn't there:

| Rule | Status |
|------|--------|
| `systems/` ↛ `pixi.js` | 🔒 `noPixiInGameEngine.test.ts` |
| `systems/` ↛ dev-only letsplay tree | 🔒 `letsplayDevOnly.test.ts` |
| `systems/` ↛ `onnxruntime-web` | 🔒 `noOnnxRuntime.test.ts` |
| **General `systems/` ↛ `presentation/`** | 🔒 `noPresentationInSystems.test.ts` — **allowlist-based** |
| MODULES.md's `import/no-restricted-paths` ESLint zones | 📝 **not enabled** (still a "next step" in `MODULES.md`) |

`noPresentationInSystems.test.ts` pins **one sanctioned exception**: `GameEngine.ts`
imports `Renderer`, `preloadTextures`, and the `GameScene` type from
`@/presentation/`. This is pre-existing engine↔renderer coupling that has **not**
been hidden behind a port. The allowlist locks that surface — a *new* `systems/` →
`presentation/` import (or a new GameEngine one) reds the test. To remove an entry,
follow the recipe above (define a port, no-op fallback) and delete it from the
allowlist. **Open cleanup:** the GameEngine↔`Renderer`/`textures` coupling is the
last un-ported upward import; porting it would let the test drop to a zero-exception
allowlist.

## Adapters vs. services

- **Adapters** (`src/core/adapters/`) wrap an existing concrete class to satisfy a
  port without changing it — `SaveManagerAdapter`→`SaveManager`,
  `QuestManagerAdapter`→`QuestManager`, `ExceptionHandlerAdapter`→
  `GlobalExceptionHandler`. Pure delegation.
- **Services** (`src/core/services/`) are port impls written *as* the impl —
  `GalaxyService`, `PlayerService`, `SceneFactory`.
- **No-op adapters** (`NoOp*`) are the fallbacks above.

## The `attach*` micro-seams

Some services take an optional collaborator *after* construction rather than via DI,
because the collaborator (the player, the bank) doesn't exist at construction time:

- `IQuestService.attachBank?(access)` — hands the quest system the bank so
  reward/fine money moves book a balanced ledger entry via the bus instead of
  poking `player.credits`. Optional: unit-test doubles that never wire the bank
  just don't implement it. Called from `GameEngine.setupPlayerBanking`
  (`GameEngine.ts:534`).
- `NpcSimulator.attachCampaignPeakPower(source)` — the day tick ratchets
  `campaignPeakPower` and the NPC sim reads it live to size Overmind garrisons.

These are the same “optional seam” idea as the ports, just resolved at runtime
rather than at wiring time.
