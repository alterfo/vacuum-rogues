---
> Superseded by docs/plans/20260630-architecture-hygiene.md Tasks 2–4

# Break Hub Import Cycles (Graph Hygiene)

## Overview
GitNexus `check` reports 5 file-import cycles, but all 5 are **type-level only** — each
has at least one `import type` back-edge that TypeScript erases at compile time, so there
is **no runtime value cycle** today. Three of them (Galaxy↔Overmind, Market↔Planet,
Quest↔types) are natural mutual *type* recursion in the domain and are deliberately left
as-is. The remaining two (Cycle 1 and Cycle 5) route through central hubs (`GameEngine`,
`BankingService`) and carry a value import in one direction; breaking them is a small,
genuine decoupling — `BankScene`/`economy` should depend on a **narrow interface**, not
the concrete hub type. This plan is graph hygiene + mild decoupling, **not** a bug fix:
behaviour must be byte-for-byte identical, gated by the full test suite.

## Context
- Cycle 1: `src/core/services/SceneFactory.ts` (`import { BankScene }`, value) →
  `src/presentation/BankScene.ts` (`import type { GameEngine }`, line 4) →
  `src/systems/GameEngine.ts` (`import { SceneFactory } from "@/core/services"`, line 69) →
  `src/core/services/index.ts` (re-export). The graph back-edge is BankScene→GameEngine, a
  **type-only** import of the whole concrete `GameEngine`.
- Cycle 5: `src/systems/banking/BankingService.ts` (`import { currentAccountId } from "./economy"`,
  value, line 22) ↔ `src/systems/banking/economy.ts` (`import type { BankingService }`, line 5).
- Cycles 2–4 (Galaxy↔Overmind, Market↔Planet, Quest↔types) are accepted mutual type
  recursion — **out of scope**, documented here so a future reviewer does not re-open them.
- Related: root CLAUDE.md "Blast Radius Analysis"; the bigger blast-radius lever is the
  large hub files (`NpcShipManager` 2751, `GameEngine` 2157, `SpaceFlightScene` 1916) —
  a separate follow-up plan, not this one.

## Development Approach
- Pure decoupling: do not change any runtime behaviour. The only edits are import shape +
  a new narrow interface; no logic moves.
- TDD/regression order: run `npm test -- --run` before and after; the suite must stay green
  with **zero** new failures (standing rule: never modify existing test assertions).
- Verify the graph with `node .gitnexus/run.cjs analyze` then `gitnexus check` — cycle count
  must drop from 5 to 3, and the 3 remaining must be exactly cycles 2–4.
- Each task is independently committable; keep one concern per commit.

## Implementation Steps

### Task 1: Decouple BankScene from the concrete GameEngine type (Cycle 1)
**Files:**
- Modify: src/presentation/BankScene.ts
- Create: src/presentation/bankSceneHost.ts (or reuse an existing port if one already fits)

- [ ] Identify exactly which members of `GameEngine` `BankScene` actually uses (read the
      class body; likely `audio`, `bank`, `getPlayer()`, `transitionTo`, etc.).
- [ ] Define a minimal `BankSceneHost` interface exposing only those members.
- [ ] Replace `import type { GameEngine }` in `BankScene.ts` with the narrow `BankSceneHost`
      type; the constructor/field keeps accepting the real `GameEngine` (it structurally
      satisfies the interface — no call-site change in `SceneFactory`).
- [ ] `npx tsc --noEmit` clean; `npm test -- --run` green.

### Task 2: Decouple economy from the concrete BankingService type (Cycle 5)
**Files:**
- Modify: src/systems/banking/economy.ts

- [ ] Find where `economy.ts` references the `BankingService` type (line 5 import + uses).
- [ ] If it only needs a couple of methods, replace the `import type { BankingService }`
      with a local narrow interface (e.g. `BankLike`) covering just those members; otherwise,
      if the type is only used in a position that can read from an existing port/interface,
      use that instead.
- [ ] Confirm `BankingService` still satisfies the narrowed type structurally — no change in
      `BankingService.ts` call sites.
- [ ] `npx tsc --noEmit` clean; `npm test -- --run` green.

### Task 3: Re-index, verify cycle reduction, document accepted cycles
**Files:**
- Modify: docs/plans/20260630-break-import-cycles.md (record the final cycle list)

- [ ] `node .gitnexus/run.cjs analyze` to refresh the graph.
- [ ] `gitnexus check` (repo SpaceRangersOnline): assert cycleCount == 3 and the 3 are
      exactly Galaxy↔Overmind, Market↔Planet, Quest↔types.
- [ ] Add a short "Accepted type cycles" note to this plan listing those 3 with the rationale
      (natural mutual type recursion; `import type` erased at runtime).
- [ ] Final gate: `npm test -- --run` green, `npx tsc --noEmit` clean, `npm run lint` clean.
