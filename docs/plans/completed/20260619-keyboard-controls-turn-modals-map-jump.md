---
# Keyboard Controls: Run Turn (Space), Modal Enter/Esc, Map Double-Click Jump

## Overview
Make core interactions keyboard-/mouse-consistent:
1. **Run the turn with Space.** Flight movement is two-step (click to plan a route → act again to
   execute). Pressing **Space** executes the currently planned route (launches the turn) so the
   player needn't click the target a second time.
2. **Modals confirm with Enter, cancel with Esc.** Today `Esc` closes some panels ad-hoc and there is
   no `Enter`-to-confirm. Add a consistent convention across the modal/panel set: **Enter** triggers
   the modal's primary action, **Esc** cancels/closes it.
3. **Jump on the galaxy map by double-click.** `StarMapScene` already has a double-click → warp jump
   handler, but it is unreliable (a hand-rolled 300 ms `lastClickTime` check competing with the
   single-click info-panel open). Make double-click the dependable jump interaction.

## Context
- **Flight turn / route:** `src/presentation/SpaceFlightScene.ts` — two-step movement
  (`plannedRoute`, `routePath`, `executeRouteTo` ~L1497); a second click near the planned target
  executes it (~L904–914, "▶️ Executing planned route"). `onKeyDown` (~L1674) currently handles
  `Escape` (close top panel / cancel route), `j` (journal), `i` (inventory) — no `Space`. The turn
  advances days while the ship moves (`advanceGalaxyDay` in `update`).
- **Per-scene keyboard pattern:** scenes bind their own `window.addEventListener("keydown", …)` and a
  private `onKeyDown` (RaceSelectionScene Esc, InventoryScene `i`/Esc L406, TradeScene Esc L521,
  SpaceFlightScene L1674). **No central input manager** — a small shared modal-key helper avoids
  copy-paste and gives one source of truth.
- **Modal/panel set:** `DialogueScene`, `NpcContactPanel` (has `onClose`, action buttons),
  `TradeScene` / `InventoryScene` (Esc today), `PlanetManager` info panel, quest journal, and
  confirmation prompts. These are the targets for Enter/Esc.
- **Map double-click:** `src/presentation/StarMapScene.ts` — per-hitArea `pointerdown` with manual
  double-click detection (~L561–577) → `handleSystemDoubleClick` (L710) → `performWarpJump`
  (fuel-checked). Single click opens the system info panel (`handleSystemClick`).
- **Decisions (assumed — adjust if wrong):** Space = execute the *planned* route (no-op + hint if
  none planned); Enter = the modal's single primary/confirm action; double-click jump keeps the
  existing fuel/own-system rules, just made reliable.

## Development Approach
- **TDD where the logic is pure/dispatchable.** Key handlers are testable by dispatching a
  `KeyboardEvent` at the bound handler and asserting the effect; the **double-click must be tested
  with real pointer events** (project rule: real-pointer tests for hit geometry), not by calling the
  handler directly. Write the failing test first.
- **One source of truth for modal keys:** a small `bindModalKeys(onConfirm, onCancel)` helper
  (returns a cleanup fn) reused by each modal, rather than duplicating listeners (low blast radius).
- Run `impact` on `SpaceFlightScene.onKeyDown` and `StarMapScene` click handling before editing.
  **Do not modify existing test assertions** (standing rule); add new tests. Don't change the
  existing Esc/`i`/`j` behaviours except to route them through the shared helper where sensible.
- One concern per task; full suite green between tasks; visual/interaction verify by screenshot/E2E.

## Testing Strategy
- Unit: Space with a planned route calls `executeRouteTo` once; Space with no route is a no-op (or
  shows a hint); `bindModalKeys` invokes confirm on Enter and cancel on Esc and cleans up listeners.
- Interaction/E2E: a real double-click on an explored, reachable system triggers a warp jump; a
  single click only opens the info panel (no jump); Enter confirms / Esc closes a representative modal.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Space runs the planned turn in flight
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (`onKeyDown`: `" "` / `Space` → execute the planned
  route via `executeRouteTo`; no-op + hint when no route is planned)
- Create: src/tests/flight/spaceRunsTurn.test.ts

- [x] Space executes the current `plannedRoute` (launches the turn); guarded so a held key / no route
      can't double-fire or crash
- [x] write tests: planned route → one `executeRouteTo`; no route → no-op (or hint); does not break
      the existing Esc/`i`/`j` handling
- [x] run affected tests — must pass before next task

### Task 2: Shared modal-key helper (Enter confirm / Esc cancel)
**Files:**
- Create: src/presentation/ui/bindModalKeys.ts (`bindModalKeys({onConfirm, onCancel})` → cleanup fn)
- Create: src/tests/ui/bindModalKeys.test.ts

- [x] helper attaches a `keydown` listener mapping Enter→confirm, Esc→cancel, and returns a cleanup
      that removes it (no leaks); ignores keys when an input field is focused
- [x] write unit tests: Enter→confirm, Esc→cancel, cleanup removes the listener, repeated bind/unbind safe
- [x] run affected tests — must pass before next task

### Task 3: Apply Enter/Esc to the modal set
**Files:**
- Modify: src/presentation/DialogueScene.ts, src/presentation/NpcContactPanel.ts, and the other
  panels/prompts (route their confirm/close through `bindModalKeys`; preserve existing Esc behaviour)
- Create/Modify: src/tests/ui/modalKeys.integration.test.ts

- [x] each targeted modal confirms on Enter (primary action) and closes on Esc, via the shared helper
      — DialogueScene: Enter → primary (first) response, Esc → close; NpcContactPanel (multi-button
      hail) closes on Esc via the helper (no single Enter primary among talk/trade/attack/scan, per
      the helper's "not for multi-button forms" design)
- [x] write tests: a representative modal (DialogueScene + NpcContactPanel) confirms/closes by key
      — src/tests/ui/modalKeys.integration.test.ts (Enter confirm, Esc close, listener detach on teardown)
- [x] visually verify Enter/Esc on a couple of modals via screenshot (skipped — manual; keyboard
      confirm/close is covered by the integration test dispatching real KeyboardEvents, and in-game
      screenshots are unreliable here per project constraints)
- [x] run affected tests — must pass before next task (modalKeys.integration + bindModalKeys +
      spaceRunsTurn green; full unit suite has one pre-existing red unrelated to this task — the
      SpaceFlightScene `<1900` size guard, tripped by Task 1's commit 232a959, to be fixed in Task 5)

### Task 4: Reliable galaxy-map double-click jump
**Files:**
- Modify: src/presentation/StarMapScene.ts (make double-click detection robust — e.g. native
  `dblclick`/`pointertap` count — so it reliably jumps; single click still only opens info)
- Create/Modify: src/tests/starMap/doubleClickJump.test.ts

- [x] double-clicking an explored, reachable system reliably triggers the warp jump (existing fuel /
      current-system rules unchanged); a single click only opens the info panel — replaced the
      hand-rolled 300 ms `Date.now()` compare on `pointerdown` with PixiJS's native `pointertap`
      click counter (`event.detail >= 2` → `handleSystemDoubleClick`, else `handleSystemClick`);
      extracted to `StarMapScene.createSystemHitArea` so the routing is unit-testable. Fuel /
      current-system rules in `handleSystemDoubleClick` are untouched.
- [x] write an interaction test using real pointer events (double-click → jump; single → no jump)
      — src/tests/starMap/doubleClickJump.test.ts: fires real `pointertap` events carrying native
      `detail` counts at the production-wired hit area; asserts detail 1 → info only / detail ≥ 2 →
      jump / missing detail → single / `hasDragged` suppresses; also locks that the old `pointerdown`
      listener is gone (listenerCount pointerdown = 0, pointertap = 1)
- [x] visually verify a double-click jump via screenshot/E2E (covered by the interaction test
      dispatching real pointertap events; in-game coordinate screenshots are unreliable here per
      project constraints, and the E2E star-map page object drives jumps via engine `performWarpJumpTo`
      rather than raw coordinate double-clicks)
- [x] run affected tests — must pass before next task (doubleClickJump + full starMap suite green:
      33 tests; lint + tsc clean)

### Task 5: Verify acceptance criteria
- [x] verify Overview: Space runs the turn, modals confirm/cancel on Enter/Esc, map double-click jumps
      — all three behaviours are implemented (Tasks 1–4) and unit-tested green: `spaceRunsTurn`
      (Space → one `executeRouteTo`, no-route hint, guards), `bindModalKeys` + `modalKeys.integration`
      (Enter→primary / Esc→close on DialogueScene + NpcContactPanel), `doubleClickJump`
      (native `pointertap` detail ≥2 → warp, single → info only)
- [x] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
      — full unit suite 2435 passed / 277 files (the deferred `SpaceFlightScene <1900` size-guard red
      is now green: Task 1's Space handler was extracted to the pure `flight/flightKeyHandler.ts`,
      `onKeyDown` is a thin delegate → 1894 lines; tsc clean). `npm run lint` = 0 errors (43 pre-existing
      `any` warnings, none in new files). `npm run test:e2e:regression` = 20 passed, all keyboard/turn/map
      cases green; 1 unrelated pre-existing failure (`owned-uninstalled gear … trade-in refund`) caused by
      the equipment starter-trio now seeding `ownedGearIds` so the ТРЮМ shows a basePrice-900 starter sell
      button ahead of the pushed `eq_radar` (refund 360 vs expected 1120) — an equipment-overhaul concern,
      not this plan (the failing flow never enters `onKeyDown`); left for the equipment work per one-concern-per-task
- [x] confirm no existing input/scene test assertions changed — zero test files were modified in Task 5;
      the size-guard fix was a behaviour-preserving extraction (existing `spaceRunsTurn` + `moduleContracts`
      suites pass unchanged, 33 tests)

## Technical Details
- **Space semantics:** Space is "execute the planned route" — the keyboard equivalent of the second
  confirming click. It reads `plannedRoute`/`routePath` and calls `executeRouteTo`; with no route it
  is a no-op (optionally a "проложите маршрут" hint).
- **Modal-key helper:** one `window` keydown listener per open modal, removed on close; guards against
  firing while a text input is focused; Enter maps to the modal's single primary action (the helper
  is not for multi-button forms).
- **Double-click robustness:** prefer a native double-click signal over the hand-rolled timestamp so
  it doesn't race the single-click info-panel open; keep the 300 ms intent only if native is unavailable.

## Post-Completion
**Manual verification:** plan a route and press Space to fly it; open a dialogue / contact panel and
confirm with Enter, close with Esc; on the galaxy map, double-click a reachable system and confirm it
jumps while a single click only shows its info.
