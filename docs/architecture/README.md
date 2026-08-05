# Architecture

How the game is put together, at the level above any single subsystem. Start here.

| Doc | Answers |
|-----|---------|
| [`MODULES.md`](./MODULES.md) | What are the modules and the dependency rule between them? (the layer map) |
| [`SEAMS.md`](./SEAMS.md) | Where do layers touch, and what contract governs each touch? (ports, adapters, DI, no-op fallbacks) |
| [`BUSES.md`](./BUSES.md) | What are the shared channels — the banking bus, callbacks, the news feed? |
| [`DATA-FLOW.md`](./DATA-FLOW.md) | What path does data actually take at runtime? (frame loop, day tick, scene swap, save/load, banking, quests) |
| [`LETSPLAY_ENGINE.md`](./LETSPLAY_ENGINE.md) | How the dev-only agent plays the real engine (autopilot, neural policy). |

## The one-paragraph mental model

`GameEngine` (`src/systems/GameEngine.ts`) orchestrates everything. It depends only
on **narrow port interfaces** (`src/core/ports/`), which `DIContainer` /
`main.ts` bind to concrete implementations — so `systems/` never imports
`presentation/` or the dev test tree directly ([`SEAMS.md`](./SEAMS.md)). Two clocks
drive the game: a **frame loop** (`gameLoop`, ms dt → `scene.update`) and a **day
tick** (`DayTickController.run`, a fixed-order fan-out to NPC sim, galaxy sim,
Overmind arc, quests, banking EOD) ([`DATA-FLOW.md`](./DATA-FLOW.md)). All money
moves over one command/event bus, `BankBus`, and `player.credits` is a *projection*
of the ledger, never the source of truth ([`BUSES.md`](./BUSES.md)). State persists
as a `SaveState` that is Zod-validated then migrated on load.

## Invariants worth memorizing

Each tagged by how it's enforced — **🔒 test/lint · ⚙️ runtime · 📝 prose only** —
so you know which have a safety net and which rely on you.

- 🔒/📝 **Cross a layer via a port**, with an optional injection + no-op fallback —
  never a direct upward import. *(Guarded for `pixi.js`, the dev letsplay tree, ONNX,
  and `systems/`→`presentation/` via an allowlist test; the general ESLint zone rule
  is still unenabled — see [`SEAMS.md § Enforcement status`](./SEAMS.md).)*
- ⚙️ **One core on the banking bus** (`BANK_BUS_HANDLER_SET` throws). 📝 Never
  `player.credits ±= x` — go through `economy.ts` → `BankBus` *(convention)*.
- 📝 **The day-tick order is a contract** — steps read what the previous one wrote.
- 📝 **`dismissAll` before `clearUILayer`** on every scene teardown *(F4 regression)*.
- 🔒 **Validate before migrate** on load; **revalidate loadout** after `fromJSON`
  *(`npm run test:save-compat`)*.
- ⚙️ **Determinism:** the day tick reseeds its RNG from `galaxy.id + day`.

Guard tests live in `src/tests/architecture/`
(`noPixiInGameEngine`, `letsplayDevOnly`, `noOnnxRuntime`,
`noPresentationInSystems`, `docAnchorsExist`). See root `CLAUDE.md` for the wider
gates (save-compat, layer lint).
