# Font-Scale Layout & Galaxy Faction Bug-Fix Pack: 3 playtest-found bugs

## Overview

Three bugs found by the user during a longer play session (2026-07-08):

1. **Large font-size mode overlaps/clips/overflows UI text** — most visible on the quest
   board panel opened from a planet, but the same class of bug (fixed pixel row heights,
   fixed y-offsets, character-count truncation instead of word-wrap) may exist in other
   panels that share the same font-scale seam.
2. **Every star system in a galaxy shows owner "INDEPENDENT"** — the system-info plaque on
   the star map literally displays the raw string `INDEPENDENT` for every single system,
   with no faction variety anywhere in the galaxy.
3. **A fleeing NPC can escape past the system boundary; the player can't follow** — the
   player is only *soft*-bounded (the camera stops panning at the edge, so clicks can't
   target beyond it), while a fleeing NPC's real-time position has no boundary check at all
   and can run to any distance, becoming permanently unreachable.

All three follow the CLAUDE.md regression-first process: red test → fix → green → visual
verification by screenshot for the visual ones.

**Sequencing constraint:** a ralphex run is active on this branch (`docs/plans/20260706-ui-flight-bugfixes.md`).
This plan's file scope does not overlap that run's touched files (`FlightHud.ts`,
`ShipPhysics.ts`, `SpaceFlightScene.ts`'s `performWarp`/entry-spawn code, `InventoryScene.ts`),
but per project convention never run two ralphex instances concurrently on the same branch —
start this plan only after that run stops/completes.

## Context (from discovery — file:line pointers)

### Bug 1: font-scale overlap/clip/overflow

- **Font-scale mechanism**: `src/utils/fontScale.ts:1-29` — `FontSizeKey = "S"|"M"|"L"` →
  `FONT_SCALES = {S:0.85, M:1.0, L:1.25}`, persisted in `localStorage("fontScale")`.
  `scaledFont(base)` only scales font **size** — it never touches layout dims (row heights,
  fixed y-offsets, box widths). Consumers must scale those themselves. Shared text factory:
  `src/presentation/ui/scaledText.ts:134-167`.
- **The quest panel on a planet** is `JobBoardPanel` (`src/presentation/JobBoardPanel.ts`,
  595 lines), opened via `PlanetScene.openJobBoard()` (`src/presentation/PlanetScene.ts:1477-1507`)
  and reused by `StationScene` for military bases.
- **Root cause in `JobBoardPanel.ts`**:
  - Fixed geometry constants independent of font scale: `W=520`, `ROW_H=60`,
    `ROW_H_OFFER=130`, `HEAD=48` (`:62-67`).
  - `addRow()` (`:391-457`): hardcoded y-offsets `y+6`/`y+20`/`y+36`/`y+50` for
    tag/title/issuer/description — none grow with `scaledFont`'s taller line height at "L",
    so rows can vertically overlap.
  - Title truncated by **character count**, not pixel width: `tpl.title.length > 36 ? ... :
    ...` (`:415-416`) — no `wordWrap`; at "L" scale the same 36-char string is wider and can
    run into the reward text anchored at `x = W-90` (`:469`) → text-over-text overlap.
  - Description DOES use `wordWrap`/`wordWrapWidth: W-120` (`:430-434`), but the row/card
    height (`ROW_H_OFFER=130`) is **fixed** — extra wrapped lines at larger font overflow
    into the next row or get clipped by the offers mask (`:220-224`).
  - `addActiveRow()` (`:339-389`) has the same fixed-offset pattern.
- **Existing pattern that already solves this**: `src/presentation/QuestJournalUI.ts` uses
  `src/presentation/ui/questCardLayout.ts` (`layoutQuestCard`/`estimateWrappedLines`/
  `MIN_CARD_HEIGHT`) for **dynamic, content-driven card height**. `JobBoardPanel` never
  adopted this pattern — it should.
- **Existing tests**: `src/tests/presentation/jobBoardScaledText.test.ts` (asserts font
  size/color scale, but nothing about row height/offset/overlap at "L"),
  `jobBoardScroll.test.ts`, `jobBoardMinRank.test.ts` (default "M" scale only),
  `src/tests/presentation/questCardLayout.test.ts` (the pattern to mirror for the fix).
- **Other candidate panels for the same fixed-geometry pattern** (found via
  `grep -rl "scaledText\|scaledFont" src/presentation`, need per-panel audit — see Task 3):
  `BankScene.ts`, `EquipmentShopScene.ts`, `GameOverScene.ts`, `InfoCenterScene.ts`,
  `InventoryScene.ts`, `PlanetScene.ts`, `StationScene.ts`, `TextQuestScene.ts`,
  `TradeScene.ts`, `ui/HangarPanel.ts`, `ui/AccessibilityPanel.ts`, `ui/HelpPanel.ts`,
  `ui/MicromoduleApplyPanel.ts`, `ui/SettingsPanel.ts`. (Flight-module panels and
  `QuestJournalUI` are excluded — flight modules restyle in place per
  `flight/playtest-traps.md`, and `QuestJournalUI` already uses the dynamic pattern.)

### Bug 2: every system shows owner INDEPENDENT

- **`FactionType`** (player-race enum, 5 values) is `src/types/index.ts:22-28`. The actual
  system-ownership enum is **`Faction`** (`src/types/faction.ts:1-9`) — same 5 values plus
  `INDEPENDENT` and `OVERMIND`. `StarSystem.ownerFaction: Faction` (`src/domain/StarSystem.ts:29`).
- **Root cause — `src/systems/GalaxySimulator.ts:100-121`**: inside the per-system generation
  loop, line 101 hardcodes `const faction = "INDEPENDENT" as Faction;` unconditionally — no
  distribution/weighting logic exists at all. The `as Faction` cast bypasses type-checking.
  This is passed straight into `generateStations(...)` and the `StarSystem` constructor. It
  reproduces on every seed, every run — not probabilistic, not an edge case.
- **`ownerFaction` is never reassigned after construction anywhere else in the codebase**
  (confirmed via `grep -rn "\.ownerFaction\s*="`) — it is a static, generation-time field,
  distinct from live Overmind/pirate capture state (`Galaxy.overmindSystems`/`pirateSystems`,
  tracked separately, never written back to `StarSystem.ownerFaction`). So fixing generation
  is a complete fix for this bug — no live-update path needs touching.
- **`assignFactionHomeSystems` already exists** (`GalaxySimulator.ts:658-722`, called at
  `:259`) — picks one "home" system per playable faction (`HOME_FACTIONS`, `:645-651`),
  spread spatially, and sets `isFactionHome = true` + `homeFactionId = faction` (`:703-705`),
  plus overrides the home system's economy type (`:707-719`). **It never touches
  `ownerFaction`** — so even a faction's own "home" system currently displays as owned by
  INDEPENDENT. This is the second half of the fix: a faction's home system should show that
  faction as owner.
- **Existing per-system seeded-RNG pattern to mirror**: `src/systems/galaxy/starTypeDistribution.ts`
  (`pickStarType`, called inline per-system at `GalaxySimulator.ts:87` via
  `new SeededRNG(`${seed}_star_${i}`)`, so it never perturbs the shared `this.rng` stream
  other downstream generation depends on for determinism) and
  `src/systems/galaxy/systemTechDistribution.ts` (`SYSTEM_TECH_WEIGHTS`, `pickSystemTechLevel`
  — a weighted-table pick over a `ReadonlyArray<readonly [value, weight]>`).
- **Display bug (secondary, same UI surface)** — `src/presentation/StarMapScene.ts:936-937`:
  `` text: `Владелец: ${system.ownerFaction}` `` renders the **raw enum value**, no i18n/label
  lookup. Even once generation produces varied factions, this would print `BASTIONS` instead
  of "Бастионы". `src/config/factionConfig.ts` has a `FACTION_LABEL` map but it only covers
  the 5 playable factions, falling back to the raw string for `INDEPENDENT`/`OVERMIND`.
  `GovernmentScene.ts`, `PlanetScene.ts` already have their own local
  `INDEPENDENT: "Независимая"` maps — precedent for the label text to reuse.
- **Gameplay blast radius of `ownerFaction`** (non-combat, safe to randomize including the
  home system): `src/systems/info/InfoService.ts:57` (`factionPriceFactor`, price flavor) and
  `src/systems/encounters/encounterFlight.ts:34/82` (rescue-quest reputation beneficiary).
  Not tied to combat hostility (that's `src/systems/npc/factionHostility.ts`, keyed on
  `FactionKind`, unrelated to `StarSystem.ownerFaction`).
- **No existing test** covers faction diversity/distribution at generation.
  `src/tests/galaxy/galaxyConnectivity.test.ts` / `galaxyTechLevel.test.ts` hardcode
  `"INDEPENDENT"` as a **fixture input** when manually constructing `StarSystem` test
  objects — they don't call `generateGalaxy` and are unaffected by this fix. Do not touch
  them.

### Bug 3: fleeing NPC escapes past the system boundary, player can't follow

- **The player is bounded only by the camera, never by a real position clamp.**
  `src/presentation/flight/CameraController.ts:365-380` (`clampPan()`) clamps the **camera
  focus point** to `[star ± boundaryRadius]`, fed via `CameraControllerDeps.boundaryRadius`
  (`CameraController.ts:15`, wired from `SpaceFlightScene.ts:453` →
  `this.SYSTEM_BOUNDARY_RADIUS` at `SpaceFlightScene.ts:92`, itself
  `SYSTEM_GEOMETRY.boundaryRadius` in `src/config/balance.ts:299`, value `2800`).
  `src/systems/ShipPhysics.ts` has **no boundary/radius check anywhere** — `update()`
  (`:175-279`) advances `shipX/shipY` unconditionally. Because `applyTransform()` always
  calls `clampPan()` (`CameraController.ts:344-347`) and click-to-move destinations are
  derived via `screenToWorld()` off that clamped transform (`SpaceFlightScene.ts:976-978`),
  the player can never *click* a destination past the boundary — this is what reads as "I
  can't go past the edge," even though nothing clamps the ship's actual coordinates. The
  player only crosses the boundary via the deliberate warp mechanism
  (`pendingWarp`/`warpEdgePoint()` in `src/utils/flightGeometry.ts:41-63`, →
  `performWarp()` at `SpaceFlightScene.ts:1418`).
- **NPC flee movement is fully unbounded.** Break-off/flee heading decision:
  `src/systems/combat/combatManeuver.ts:61-105` (`decideManeuver`), `BREAK_OFF` mode
  triggered by `hullRatio < BREAK_OFF_HULL_RATIO` (0.3, `:51`) or being out-matched (`:80`),
  heading set directly away from the pursuer (`:84`). The actual position update for that
  heading is `src/presentation/NpcShipSprite.ts:541-570` (`maneuverToward`), invoked from the
  aggressive-pursuit branch of `update()` (`:318-331`) — it adds
  `cos/sin(heading) * speed * deltaTime` to `this.x/this.y` with **no radius/boundary check
  at all**, and this branch `return`s before ever reaching the boundary-aware
  "departing" logic further down in the same method (`:380-408`, where `this.gone = true`
  fires only when a **scripted** departure — `beginDeparture()`, `:290-303` — reaches
  `this.bounds.boundary`). A real-time `BREAK_OFF` flee never calls `beginDeparture()`, so a
  fleeing NPC is never culled and never bounded — it can run to any distance and stays in
  the system's live ship list forever, unreachable.
- **The fix direction**: make the aggressive-pursuit branch of `NpcShipSprite.update()`
  detect when `maneuverToward`'s `BREAK_OFF` heading would carry the ship past
  `this.bounds.boundary` (the same field `beginDeparture()` already uses) and route it
  through the existing departure/`gone` mechanism instead of moving unbounded — reusing
  `beginDeparture()`'s outward-radial target math rather than inventing a second boundary
  concept.
- **No existing test** asserts that an NPC's (or the player ship's) actual `x/y` is
  clamped to `SYSTEM_BOUNDARY_RADIUS`. Relevant existing tests: `src/tests/flight/cameraController.test.ts:252-273`
  (asserts `clampPan` keeps the *camera focus* inside bounds — unrelated to ship position),
  `src/tests/playtest/letsplay/fleeNearEdge.test.ts` (covers the *player's own* deliberate
  warp-escape routing, not chasing a fleeing NPC), `src/tests/combat/combatManeuver.test.ts`
  (unit-tests `decideManeuver`'s `BREAK_OFF` heading only, no world-space bounds). A new test
  belongs in `src/tests/presentation/` (new `NpcShipSprite`/`npcShipManager` boundary test) or
  alongside `combatManeuver.test.ts` if the clamp is pushed down into that layer instead.

## Development Approach

- **Testing approach**: TDD — write a failing regression test reproducing each bug before
  implementing its fix.
- Complete each task fully (tests green) before moving to the next.
- Make small, focused changes — no refactor bundled into a bug fix.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task.
- **CRITICAL: all tests must pass before starting next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Run `gitnexus impact` before editing any shared symbol (`GalaxySimulator.generateGalaxy`,
  `JobBoardPanel`, `StarMapScene.showSystemInfo`, `NpcShipSprite.update`) — report blast
  radius before proceeding.
- Maintain backward compatibility: this is a **generation-only** change for Bug 2 (galaxy is
  persisted via `SaveStateSchema.galaxy`, no domain field added/changed) — no migration
  needed. Existing saves keep whatever galaxy they already generated (including an
  already-all-INDEPENDENT one); only new games get the fix, per project convention for
  generation changes.

## Testing Strategy

- **Unit tests**: required for every task (pure layout math, weighted-pick function, faction
  assignment, label lookup).
- **E2E/visual verification**: Bug 1 is a visual/layout bug — verify via real Playwright
  screenshot at the "L" font setting (per CLAUDE.md, green unit tests are not sufficient
  evidence for a visual bug).
- Store new tests alongside existing ones (`src/tests/presentation/`, `src/tests/galaxy/`).

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Keep this plan in sync with actual work done.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, doc updates achievable
  in-repo.
- **Post-Completion** (no checkboxes): manual verification, anything external.

## Implementation Steps

### Task 1: Red test — JobBoardPanel overlaps/clips at "L" font scale

- [x] add a regression test in `src/tests/presentation/jobBoardScaledText.test.ts` (or a new
      `jobBoardFontScaleLayout.test.ts`) that sets font scale to "L" and asserts a long quest
      title/description does NOT produce overlapping row bounds or exceed `ROW_H_OFFER` —
      must fail against current code
- [x] add a matching case for the active-quest row (`addActiveRow`) at "L" scale
- [x] run the new tests — confirm both fail (red) before implementing the fix

  Implemented in new `src/tests/presentation/jobBoardFontScaleLayout.test.ts` (3 cases): (1)
  description-overflow check reading each row's real drawn box via
  `Graphics.getLocalBounds()` (geometry-derived, works without a renderer) and estimating
  wrapped-line height with `questCardLayout.ts`'s `estimateWrappedLines`/`lineStepFor` — fails
  today (`274 > 172.5`, i.e. the description overflows the fixed `ROW_H_OFFER` box); (2)
  `addRow` title-truncation check — fails today (truncated to 35 chars + "…"); (3) matching
  `addActiveRow` title-truncation check — fails today (truncated to 27 chars + "…"). Confirmed
  all 3 red via `npx vitest run` before any fix; `npx tsc --noEmit` and `npm run lint` clean;
  existing JobBoardPanel/questCardLayout tests unaffected.

### Task 2: Fix JobBoardPanel layout — adopt dynamic content-driven height

- [x] extend or reuse `src/presentation/ui/questCardLayout.ts` (`layoutQuestCard`/
      `estimateWrappedLines`/`MIN_CARD_HEIGHT`) so `JobBoardPanel.addRow`/`addActiveRow` can
      compute per-row height from actual wrapped-line count and current `scaledFont` size,
      instead of the fixed `ROW_H`/`ROW_H_OFFER` constants
- [x] replace the character-count title truncation (`tpl.title.length > 36 ? ...`) with
      `wordWrap`/`wordWrapWidth` (matching the description's existing approach), sized to
      leave clearance before the reward text at `x = W-90`
- [x] recompute row y-offsets and the offers-list scroll/mask geometry
      (`:220-224`) from the new dynamic row heights
- [x] make Task 1's tests green
- [x] run `npm test -- --run` targeted files + `npx tsc --noEmit` + `npm run lint` — must
      pass before next task

  Implemented via a new pure module `src/presentation/ui/jobBoardRowLayout.ts`
  (`computeRowLayout`, reusing `questCardLayout.ts`'s `estimateWrappedLines`/`lineStepFor`):
  each offer/active row now computes its own content height from the wrapped title +
  issuer + description + highlights line counts at the current `scaledFont` size, floored
  at the historical `MIN_OFFER_ROW_H`/`MIN_ACTIVE_ROW_H` (124/54) so short quests keep the
  old pixel size exactly. `JobBoardPanel` tracks per-row cumulative offsets
  (`offerRowOffsets`) instead of a fixed `ROW_H_OFFER` step, for both the render loop and
  `scrollOffers`'s pixel math (the visible/max-scroll calc now sums variable trailing-row
  heights instead of dividing by a constant). Title truncation (`slice(35)+"…"` /
  `slice(27)+"…"`) replaced with `wordWrap`/`wordWrapWidth` in both `addRow` and
  `addActiveRow`. Made all 3 of Task 1's red tests green; full suite green (544 files / 5164
  tests, 5 pre-existing skips); `npx tsc --noEmit` and `npm run lint` clean (46 pre-existing
  `no-explicit-any` warnings in unrelated test files, 0 errors). Also verified via the
  existing E2E test `Job Board text scales with the S/M/L font setting` (screenshot
  `jobboard-fontscale-L.png`) — rows now grow to fit long titles/descriptions instead of
  clipping.

  ⚠️ **Note for Task 1/2 commit**: the pre-commit hook (`lefthook.yml`) runs the staged test
  file through `npm test`, which fails on a deliberately red TDD test — so Task 1 (red) and
  Task 2 (fix) had to land in one combined commit to satisfy "never skip hooks." Both tasks'
  checkboxes are recorded above for plan-tracking accuracy; the actual commit history has
  them as a single commit.

  ➕ **Newly discovered (out of scope here, for Task 3's audit)**: the offer row's
  highlight-tags loop (`addRow`, `hx += tagSpacing` where `tagSpacing = 140`) predates this
  fix and is unrelated to `ROW_H_OFFER`/title-truncation — but the E2E screenshot shows
  adjacent highlight tags (e.g. `[Планета: ...]`, `[Выдан: planet <id>]`) visually
  overlapping because a bracketed label+value string is often wider than 140px, even at "M"
  scale. Confirmed pre-existing: this iteration only changed `hy`'s *source* (from a fixed
  `y + ROW_H_OFFER - 30` to `y + layout.highlightsY`), never the `hx`/`tagSpacing` loop
  itself. Flagging for Task 3 rather than fixing here (separate root cause, avoid bundling
  an unrelated fix into this task).

### Task 3: Audit remaining panels for the same fixed-geometry font-scale bug

- [ ] for each candidate panel listed in Context (BankScene, EquipmentShopScene,
      GameOverScene, InfoCenterScene, InventoryScene, PlanetScene, StationScene,
      TextQuestScene, TradeScene, HangarPanel, AccessibilityPanel, HelpPanel,
      MicromoduleApplyPanel, SettingsPanel), check for hardcoded row heights/y-offsets or
      character-count truncation independent of `scaledFont`/wordWrap, focusing on
      list/multi-row layouts first (HangarPanel warehouse rows, TradeScene commodity rows,
      BankScene ledger rows, InfoCenterScene news/rumor rows) — grep + read, no edits yet
- [ ] for each panel where a genuine overlap/clip/overflow risk is confirmed at "L" scale,
      write a failing regression test first (mirroring Task 1's approach)
- [ ] fix each confirmed panel using the same dynamic-height/wordWrap pattern from Task 2
- [ ] if a panel is checked and found NOT to have the bug (e.g. already scale-safe or
      single-line-only), note it in this plan with ⚠️/note rather than silently skipping
- [ ] run full targeted test suite — must pass before next task

### Task 4: Red test — galaxy generation produces zero faction diversity

- [ ] add a regression test in `src/tests/galaxy/` (new file, e.g.
      `galaxyFactionDistribution.test.ts`) asserting `GalaxySimulator.generateGalaxy(seed,
      systemCount)` with a reasonably sized galaxy produces **more than one** distinct
      `ownerFaction` value across generated systems — must fail against current code
      (currently always exactly 1: `INDEPENDENT`)
- [ ] add an assertion that each system with `isFactionHome === true` has
      `ownerFaction === homeFactionId`
- [ ] run the new test — confirm it fails (red) before implementing the fix

### Task 5: Implement weighted per-system faction distribution

- [ ] add `FACTION_DISTRIBUTION_WEIGHTS` to `src/config/balance.ts` (named constants, single
      source of truth per project convention) covering `INDEPENDENT` + the 5 `HOME_FACTIONS`
      values, documented with a comment explaining the chosen split
- [ ] create `src/systems/galaxy/systemFactionDistribution.ts` mirroring
      `systemTechDistribution.ts`'s weighted-pick shape: `pickSystemFaction(rng: {
      next(): number }): Faction`
- [ ] in `GalaxySimulator.ts`, replace the hardcoded `const faction = "INDEPENDENT" as
      Faction;` (`:101`) with a per-system seeded pick — `pickSystemFaction(new
      SeededRNG(`${seed}_faction_${i}`))` — mirroring the `pickStarType` inline pattern so
      the shared `this.rng` stream (and downstream determinism) is untouched
    - [ ] in `assignFactionHomeSystems` (`:658-722`), also set
      `best.ownerFaction = faction as unknown as Faction` alongside the existing
      `homeFactionId` assignment, so a faction's home system always displays as owned by
      that faction regardless of what its generation-time roll produced
- [ ] write unit tests for `pickSystemFaction` (weighted distribution over many draws,
      deterministic given a fixed seed)
- [ ] make Task 4's tests green
- [ ] run `gitnexus detect_changes` — confirm scope matches expectations, no unexpected
      execution-flow breakage
- [ ] run `npm test -- --run` targeted files + `npx tsc --noEmit` + `npm run lint` — must
      pass before next task

### Task 6: Fix StarMapScene raw-enum owner display

- [ ] extend `FACTION_LABEL` in `src/config/factionConfig.ts` to cover `INDEPENDENT` and
      `OVERMIND` (matching the localized text already duplicated in `GovernmentScene.ts`/
      `PlanetScene.ts`'s local maps)
- [ ] update `src/presentation/StarMapScene.ts:936-937` to render
      `FACTION_LABEL[system.ownerFaction] ?? system.ownerFaction` instead of the raw enum
      value
- [ ] write/update a unit test asserting `FACTION_LABEL` covers every `Faction` enum value
      (a completeness guard so a future new faction can't silently regress to a raw string)
- [ ] write a test (or extend an existing `StarMapScene` test) asserting the info-panel text
      shows a localized label, not a raw enum value, for an `INDEPENDENT` system
- [ ] run targeted tests — must pass before next task

### Task 7: Red test — fleeing NPC crosses the system boundary unbounded

- [ ] add a regression test (new `src/tests/presentation/npcShipBoundary.test.ts` or
      alongside `combatManeuver.test.ts`, whichever layer ends up owning the clamp) that
      drives a `BREAK_OFF` flee (low hull ratio or out-matched pursuer) toward/past
      `bounds.boundary` over repeated `update()` ticks and asserts the NPC's distance from
      the system centre never exceeds `bounds.boundary` (or that it transitions to
      `isGone()` at the boundary instead of continuing outward) — must fail against current
      code
- [ ] add a case confirming a normal (non-fleeing) aggressive pursuit inside the boundary is
      unaffected (no regression to ordinary chase behavior)
- [ ] run the new test — confirm it fails (red) before implementing the fix

### Task 8: Fix — bound fleeing NPC movement to the system boundary

- [ ] in `NpcShipSprite` (`src/presentation/NpcShipSprite.ts`), make the aggressive-pursuit
      branch of `update()` (`:318-331`)/`maneuverToward` (`:541-570`) detect a `BREAK_OFF`
      decision that would carry the ship past `this.bounds.boundary` from the system centre,
      and route it into the existing departure path (`beginDeparture()`, `:290-303`) instead
      of moving the ship unbounded
- [ ] confirm `NpcShipManager` (the `isGone()` consumers at `:458-462`/`:860`) correctly
      despawns/cleans up a ship that reaches `gone` via this new path the same way it does
      for a scripted departure (garrison/pursuit-tracking sets, aggressor bookkeeping)
- [ ] write unit tests for the boundary-triggered departure transition (NPC at various
      hull-ratio/out-matched states fleeing from various angles/positions)
- [ ] make Task 7's tests green
- [ ] run `gitnexus impact NpcShipSprite` — confirm no unexpected callers broken
- [ ] run `npm test -- --run` targeted files + `npx tsc --noEmit` + `npm run lint` — must
      pass before next task

### Task 9: Verify acceptance criteria

- [ ] verify Bug 1 (JobBoardPanel + any Task 3 findings) no longer overlaps/clips/overflows
      at "L" font scale — visually confirm via a real Playwright screenshot
- [ ] verify Bug 2: a freshly generated galaxy shows varied faction owners on the star map,
      and each faction's home system shows that faction as owner
- [ ] verify Bug 3: a fleeing NPC (trigger `BREAK_OFF` in a real-engine playtest or live
      session) is bounded at the system edge and eventually despawns via departure rather
      than running to unbounded distance
- [ ] run full unit test suite (`npm test -- --run`)
- [ ] run `npm run test:playtest` and `npm run test:e2e:regression`
- [ ] run `npm run lint` and `npx tsc --noEmit` — all issues fixed
- [ ] run `gitnexus detect_changes({scope: "compare", base_ref: "master"})` — confirm no
      unexpected affected processes

### Task 10: [Final] Update documentation

- [ ] add a bullet to `src/systems/galaxy/CLAUDE.md` documenting the faction-distribution fix
      (weights location, the per-system seeded-pick pattern, the home-system override),
      mirroring the style of existing completed-plan bullets in that file
- [ ] if any panel beyond `JobBoardPanel` was fixed in Task 3, note it in
      `src/presentation/CLAUDE.md`'s scaledText/layout guidance if relevant
- [ ] add a note to `src/presentation/flight/CLAUDE.md` (or the relevant flight-module doc)
      documenting that fleeing NPCs are now boundary-clamped via the departure path, so a
      future flee/maneuver change doesn't silently reintroduce unbounded movement

*Note: ralphex automatically moves this plan to `docs/plans/completed/` on completion.*

## Technical Details

- **`Faction` enum** (`src/types/faction.ts`): `OUTLANDERS | BASTIONS | SYNDICATE |
  PARADOXES | PROGRESSORS | INDEPENDENT | OVERMIND`. Only the first 5 + `INDEPENDENT`
  participate in the new generation-time weighted pick — `OVERMIND` ownership is assigned
  later, separately, via `Galaxy.overmindSystems` (live capture state), never as a
  generation-time `ownerFaction` roll.
- **Weighted-pick shape** mirrors `SYSTEM_TECH_WEIGHTS`: `ReadonlyArray<readonly [Faction,
  number]>`, drawn via `rng.next() * total` cumulative subtraction (see
  `pickSystemTechLevel` for the exact algorithm to reuse).
- **Determinism**: every new RNG draw (faction pick) must use its own per-system seed
  (`${seed}_faction_${i}`), never the shared `this.rng` — this is the established convention
  (star type, tech level) that keeps existing generation snapshots/tests bit-identical.

## Post-Completion

**Manual verification**:
- Play a fresh game, open the star map, confirm systems show a mix of faction owners (not
  all INDEPENDENT), and that visiting a faction's home system shows a matching owner label.
- Switch font size to "L" in Settings, open the quest board on a planet with several
  available/active quests with long titles/descriptions, confirm no overlapping/clipped/
  overflowing text.
- Provoke an NPC into a low-hull or out-matched `BREAK_OFF` flee in a live session, chase it
  toward the system edge, and confirm it despawns via the departure sequence at the boundary
  instead of running off to unbounded distance.

**Known accepted gap** (do not expand scope to fix): a home system's **stations** are
generated before `assignFactionHomeSystems` runs, so a station's faction may not match its
home system's overridden owner faction — this mirrors the pre-existing behavior for economy
type (also only overridden on the system/planets, not stations) and is out of scope for this
bug-fix pack.
