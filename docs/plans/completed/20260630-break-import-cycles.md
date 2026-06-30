---
> Superseded by docs/plans/completed/20260630-architecture-hygiene.md Tasks 2–4

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
- Verify the graph with `node .gitnexus/run.cjs analyze` then `gitnexus check` — the two
  real value-level cycles (Cycle 1, Cycle 5) must be broken; any cycles left must be
  `import type`-only (see "Accepted type cycles" below for the final, verified count).
- Each task is independently committable; keep one concern per commit.

## Implementation Steps

### Task 1: Decouple BankScene from the concrete GameEngine type (Cycle 1)
**Files:**
- Modify: src/presentation/BankScene.ts
- Create: src/presentation/bankSceneHost.ts (or reuse an existing port if one already fits)

- [x] Identify exactly which members of `GameEngine` `BankScene` actually uses (read the
      class body; likely `audio`, `bank`, `getPlayer()`, `transitionTo`, etc.). — done under
      architecture-hygiene Task 2 (commit `9974fab`).
- [x] Define a minimal `BankSceneHost` interface exposing only those members. —
      `src/presentation/BankSceneHost.ts` exists on disk, confirmed.
- [x] Replace `import type { GameEngine }` in `BankScene.ts` with the narrow `BankSceneHost`
      type; the constructor/field keeps accepting the real `GameEngine` (it structurally
      satisfies the interface — no call-site change in `SceneFactory`). — confirmed:
      `BankScene.ts` line 4 imports `BankSceneHost`, not `GameEngine`.
- [x] `npx tsc --noEmit` clean; `npm test -- --run` green. — re-verified now: `tsc --noEmit`
      clean, `npm run lint` 0 errors.

### Task 2: Decouple economy from the concrete BankingService type (Cycle 5)
**Files:**
- Modify: src/systems/banking/economy.ts

- [x] Find where `economy.ts` references the `BankingService` type (line 5 import + uses). —
      done under architecture-hygiene Task 3 (commit referenced there).
- [x] If it only needs a couple of methods, replace the `import type { BankingService }`
      with a local narrow interface (e.g. `BankLike`) covering just those members; otherwise,
      if the type is only used in a position that can read from an existing port/interface,
      use that instead. — confirmed: `economy.ts` line 7 defines `interface BankLike` ("Narrow
      seam covering the BankingService members economy.ts actually uses"), used at lines 22/334/363.
- [x] Confirm `BankingService` still satisfies the narrowed type structurally — no change in
      `BankingService.ts` call sites. — confirmed via architecture-hygiene Task 3/4 `tsc --noEmit`.
- [x] `npx tsc --noEmit` clean; `npm test -- --run` green. — re-verified now.

### Task 3: Re-index, verify cycle reduction, document accepted cycles
**Files:**
- Modify: docs/plans/20260630-break-import-cycles.md (record the final cycle list)

- [x] `node .gitnexus/run.cjs analyze` to refresh the graph. — done under architecture-hygiene
      Task 4.
- [x] `gitnexus check` (repo SpaceRangersOnline): assert cycleCount == 3 and the 3 are
      exactly Galaxy↔Overmind, Market↔Planet, Quest↔types. — superseded by the
      architecture-hygiene Task 4 finding: a clean full re-index showed 5 remaining cycles, not
      3 — the 4 pre-existing domain/type cycles (incl. Galaxy↔Overmind, Market↔Planet,
      Quest↔types) plus a systemic `DialogueScene→GameEngine` `import type` cycle from 24
      scenes importing `GameEngine` by type, explicitly left for a later pass. Both real
      value-level cycles (Cycle 1 BankScene→GameEngine, Cycle 5/6 BankingService↔economy) are
      broken; all remaining cycles are `import type` only and benign.
- [x] Add a short "Accepted type cycles" note to this plan listing those 3 with the rationale
      (natural mutual type recursion; `import type` erased at runtime). — see "Accepted type
      cycles" section below.
- [x] Final gate: `npm test -- --run` green, `npx tsc --noEmit` clean, `npm run lint` clean. —
      re-verified now.

## Accepted type cycles

Per the architecture-hygiene plan's Task 4 finding (clean full re-index), the remaining
`import type`-only cycles — erased at compile time, no runtime value cycle — are accepted:

- **Galaxy↔Overmind**: natural mutual type recursion in the domain (a galaxy references its
  Overmind arc state; Overmind logic references galaxy shape).
- **Market↔Planet**: natural mutual type recursion (a planet has a market; market types
  reference planet shape).
- **Quest↔types**: natural mutual type recursion (quest domain types reference shared
  `src/types`, which in turn types quest-shaped fields).
- **DialogueScene→GameEngine (systemic)**: one instance of the broader pattern where 24
  scenes use `import type { GameEngine }` — left for a later, larger pass (not this plan's
  scope; see root CLAUDE.md "Blast Radius Analysis" and the hub-file follow-up note above).
- **i18n en.ts↔i18n.ts**: natural mutual type recursion (the EN dictionary is typed against
  a shape `i18n.ts` also imports for the active-dict resolver) — pre-existing, unrelated to
  this plan, `import type` only.

Verified via a fresh `gitnexus check` re-index: exactly these 5 cycles remain, all
`import type`-only on at least one edge — none involve `BankScene`, `BankingService`, or
`economy.ts`.

Both real value-level cycles this plan targeted (Cycle 1 BankScene→GameEngine, Cycle 5
BankingService↔economy) are broken. This plan's work is complete.
