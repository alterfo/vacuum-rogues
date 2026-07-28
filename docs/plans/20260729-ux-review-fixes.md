# UX Review Fixes (8-screen pass)

## Overview

A `ux-reviewer` pass over 8 real screenshots (MAIN_MENU, SPACE_FLIGHT, PLANET, TRADE,
EQUIPMENT_SHOP, BANK, STATION, STAR_MAP — captured live from `window.__gameEngine` via
`renderer.extract.base64`) surfaced 13 findings, 3 rated significant, 5 moderate, 5
minor/cosmetic. This plan fixes all 13.

**Important caveat surfaced during planning:** the screenshots were captured by jumping
scenes directly via `gameEngine.transitionTo(...)` (bypassing the normal click-through
navigation) to move fast. A follow-up code read shows at least 4 findings' underlying
code does NOT match what the screenshot showed (`StarMapScene` already paints a dark
`0x000510` background every render; `BankScene` already computes and shows loan-term
values unconditionally; the flight HUD's `[КВЕСТЫ]`/`[I]` buttons are already
style-identical in code; the main-menu decorative planets are already explicitly
`eventMode="none"`). These may be artifacts of the shortcut-navigation path skipping an
init step, or simply misread screenshots. **Task 1 re-verifies every contested finding
live, through the real click-through UI**, before any code changes — the plan's later
tasks are written to branch on Task 1's verdict rather than assume the finding is real.

## Context (from discovery)

Source-mapped by an Explore pass; exact locations below (also duplicated per-task):

| # | Finding | File(s) | Status going in |
|---|---------|---------|------------------|
| 1 | Star map white background | `StarMapScene.ts` L362-370 (`renderStarMap`) | **REFUTED (Task 1)** — dark `0x000510` bg painted unconditionally at layer 0 every `renderStarMap()`; mood backdrop is only an alpha-0.25 sprite at layer 1. Screenshot was a shortcut-nav artifact. No code change (Task 4 closed). |
| 2 | Raw enum leaks into bank ledger | `TradeSystem.ts:408`, `encounters/encounterFlight.ts:133`, displayed verbatim by `BankScene.ts:495-499` / `bankSceneView.ts:153` | confirmed by code |
| 3 | Station has no backdrop art | `StationScene.ts` `renderMain()` L332-341/376-386 vs `PlanetScene.ts` `resolvePlanetBackdropKey()` | confirmed by code |
| 4 | Planet economy type shown 3× | `PlanetScene.ts` L1171-1174, L1431-1432, L1499-1502, `getType()` L2032-2042 | confirmed by code |
| 5 | Threat banner has no visual weight | `StarMapScene.ts:453-472` (`warningIndicator`) | confirmed by code |
| 6 | Planet vs Station button chrome mismatch | `PlanetScene.ts` `makeServiceBtn()` L1302-1348 (uses `UiButton`) vs `StationScene.ts` L439-469 (bare `scaledText` brackets) | confirmed by code |
| 7 | Station status rows look clickable | `StationScene.ts` `serviceButton()` L537-587 + render loop L439-466 (`blocked` gate ignores non-actionable rows) | confirmed by code |
| 8 | Bank loan-terms block blank pre-loan | `BankScene.ts` `renderLoanTerms()` L300-371 → `loanPanelLines()` (`bankSceneView.ts:274-326`) | **REFUTED (Task 1)** — `loanPanelLines(summary, 0)` returns populated offer rows (Сумма кредита/Ставка/Срок/К возврату) pre-loan, covered by passing `bankSceneView.test.ts:281`. No code change (Task 9 closed). |
| 9/10 | HUD icon buttons: weight/tooltip | `FlightHud.ts` L649-732 (`[КВЕСТЫ]`/`[I]`/`[?]`), star-map tooltip pattern L773-813 | **partially contested** — `[КВЕСТЫ]`/`[I]` already style-identical in code; tooltip gap is real |
| 11 | Взлёт/Взятка cramped spacing | `PlanetScene.ts` `computePlanetMenuLayout()` L189-209 | confirmed by code (6px gap) |
| 12 | Main menu green vs cyan button | `MainMenuScene.ts` `createButton()` L408-441 (default `color=0x00ff00`), call site L443-445 | confirmed by code |
| 13 | Decorative planet icons unclear | `MainMenuScene.ts` L229-274 (`eventMode="none"` already set, commented `// decorative`) | **REFUTED (Task 1)** — decorative planet containers set `node.eventMode = "none"` (L256), so clicks are inert and pass through. No fix (Task 13 closes it). |

Related presentation-layer conventions (`src/presentation/CLAUDE.md`): dark-panel text
must go through `scaledText`/`scaledFont` (StarMapScene is explicitly listed as **not yet
migrated** — route any line this plan touches through it); PixiJS mask/eventMode traps;
station art today only covers the 80×80 flight-map marker (`stationArt.ts`), no interior
panorama category exists.

## Development Approach

- **Testing approach:** regression-first, per project convention (root `CLAUDE.md` →
  "Bug Fixing Process"). Each task: red test first (unit test for logic/text-building
  bugs; real-engine playtest test for wiring/interaction bugs per the three-tier table),
  fix until green, then a real screenshot re-capture for any visual change (text-level
  green alone is not evidence for a visual bug per project convention).
- **Screenshot verification:** reuse the working capture pipeline from this session —
  `app.renderer.extract.base64({ target: app.stage, frame: app.renderer.screen })`
  posted to a local receiver (NOT `computer`/`screenshot` tool — PixiJS's continuous
  render loop makes it hang on `document_idle`; NOT `extract.base64(app.stage)` alone —
  captures the full (huge) stage bounds, not the viewport).
- **Live verification path:** Task 1 must drive scenes via real clicks (or
  `window.__autopilot`), not `gameEngine.transitionTo(...)` shortcuts — the shortcut is
  suspected to skip an init step for at least one contested finding.
- **Blast radius:** run `gitnexus impact <Symbol>` before editing any shared symbol
  (`UiButton`, `scaledText`, `resourceLabelRu`, `computePlanetMenuLayout`,
  `loanTermsSummary`) per root `CLAUDE.md`. Report HIGH/CRITICAL risk before proceeding.
- Standard project rules apply, nothing additional: layer direction, i18n via `t()`
  where the surface already uses it (most of this UI is literal Russian strings, not
  yet on the i18n dictionary — do not migrate strings to `t()` as part of this plan,
  that's a separate, larger effort; keep edits localized to the existing string style),
  never touch existing test assertions, save-compat rules (see Task 2's note — ledger
  `reason` is baked into saved data, so localizing the *builder* does not retroactively
  fix historical entries and needs no migration).
- Small, focused commits per task; do not bundle unrelated cleanup.

## Testing Strategy

- **Unit tests**: required for every task per Development Approach.
- **Real-engine playtest / interaction tests**: for anything involving click-through,
  hover, or scene-wiring (Task 1, Task 6's button swap, Task 7's row-gating).
- **Screenshot re-capture**: required for every visual-styling task before marking done.
- No Playwright E2E suite changes anticipated — this is presentation-layer logic +
  styling, covered by the existing `src/tests/presentation/**` unit tests plus the
  real-engine playtest tier; add E2E only if a task turns out to need pointer-drag/real
  browser behavior no other tier can reach.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Tasks 4 (star map) and 10 (bank loan terms) are **contingent on Task 1's verdict** —
  if Task 1 refutes the finding, mark the task's checkboxes `[x]` with a
  "not applicable — confirmed non-issue in Task 1" note and move on; do not force a
  code change onto a non-bug.

## Implementation Steps

### Task 1: Live verification of contested findings
- [x] Start `npm run dev`, drive the game through **real click-through navigation** —
      manual/live browser step, not automatable in this headless environment (skipped —
      requires a running dev server + human-driven click-through + PixiJS render loop the
      static screenshot tools can't capture). Verdicts below derived from a definitive
      code read instead.
- [x] Capture real screenshots — non-automatable (skipped, same reason as above; the
      `extract.base64` pipeline needs a live browser + local receiver).
- [x] For finding #1 (star map bg): VERDICT = **confirmed non-bug / shortcut-only
      artifact**. `StarMapScene.renderStarMap()` (L362-370) unconditionally paints a dark
      `0x000510` `Graphics` rect at `gameLayer.addChildAt(bg, 0)` on every render; the
      only other backdrop is an `alpha=0.25` mood sprite at layer 1. No path leaves the
      map white. Table updated.
- [x] For finding #8 (bank loan terms): VERDICT = **confirmed already-populated**.
      `loanPanelLines(summary, 0)` (bankSceneView.ts:274) returns the full offer block
      (Сумма кредита / Ставка / Срок / К возврату) with zero debt, asserted green by the
      existing `bankSceneView.test.ts:281` "shows the offer … when there is no debt".
      Table updated.
- [x] For findings #9/10: `[КВЕСТЫ]` and `[I]` are style-identical in code (same font
      family/size/color per FlightHud). The live label-length affordance question is a
      manual/hover judgement (skipped — not statically capturable); the tooltip gap on
      `[I]` / top-right icon buttons is real and handled unconditionally by Task 10
      regardless of the perception call.
- [x] For finding #13: VERDICT = **confirmed inert**. Decorative planet containers set
      `node.eventMode = "none"` (MainMenuScene.ts:256) with no click handler, so pointer
      events pass through. No code change. Table updated.
- [x] Update this plan file's per-finding "Status going in" table with each verdict
      before starting Task 4/Task 10 — done (rows #1, #8, #13 marked REFUTED).

### Task 2: Localize bank ledger reason strings
- [ ] Add a Russian resource label to the sale-reason string built in
      `src/systems/TradeSystem.ts:408` (reuse `resourceLabelRu()` from
      `src/domain/RouteRumor.ts:69`, not a new mapping).
- [ ] Add a Russian encounter-outcome label to the reason string built in
      `src/systems/encounters/encounterFlight.ts:133` — extract the existing per-kind
      Russian switch from `encounterOutcomeMessage()`
      (`src/presentation/flight/EncounterController.ts:252-271`) into a small reusable
      pure function (e.g. in a shared location under `src/systems/`) and call it from
      both the toast and the ledger-reason builder, rather than duplicating the switch.
- [ ] Note in a code comment (not a migration): `entry.reason` is baked into saved
      ledger history at transaction time — this fix only affects reasons written after
      the change; no schema/migration needed, historical entries are display-only text.
- [ ] Write unit tests: `TradeSystem` sale-reason string is fully Russian for a sample
      `ResourceType` (extend existing `TradeSystem` tests or add alongside
      `src/tests/banking/bankSceneView.test.ts`); `encounterFlight` outcome-reason
      string is fully Russian for `salvage`/`rescue`/etc. kinds.
- [ ] Write a regression test in `src/tests/banking/bankSceneView.test.ts` asserting a
      ledger row built from a `TradeSystem`/`encounterFlight`-produced `reason` renders
      with no raw English enum token.
- [ ] run tests — must pass before task 3.

### Task 3: Deduplicate planet economy-type text
- [ ] Read `PlanetScene.ts` around L1171-1174 (subtitle), L1410-1432 (`addInfoPanel`
      details row), L1499-1502 (population row) to see the full current layout in
      context.
- [ ] Keep exactly one visible instance of the planet's economy-type word: keep it in
      the subtitle line (L1171-1174, already paired with habitability), remove the
      standalone repeat in the details row (L1431-1432), and rephrase the population
      row (L1499-1502) to drop the redundant `economyLabel(system?.economyType)` segment
      if it duplicates the same displayed word (keep population + government, which are
      distinct facts).
- [ ] Write/extend a unit test asserting the rendered info-panel text contains the
      economy-type label exactly once (extend
      `src/tests/presentation/planetInfoPanelProfile.test.ts`).
- [ ] run tests — must pass before task 4.

### Task 4: Fix star map background (contingent on Task 1)
- [ ] If Task 1 confirmed this is a real bug through real navigation: read
      `StarMapScene.ts` L362-370 (`renderStarMap`) and `mountOvermindMoodBackdrop()`
      L319-360 end-to-end to find why the dark `Graphics` rect isn't visible/isn't
      painted in the reproduced case (init-order bug, a mood-backdrop sprite drawn over
      it in white/opaque, a missing `addChild`, etc.) and fix the root cause.
- [ ] If Task 1 refuted this (confirmed shortcut-only artifact): mark this task's boxes
      `[x]` with a note "not applicable — confirmed non-issue in Task 1, no code
      change", and skip to Task 5.
- [ ] (If fixing) Write a unit/real-engine test asserting `StarMapScene` mounts its dark
      background before any foreground content, covering the exact repro path found.
- [ ] (If fixing) Screenshot-verify the real dark background renders correctly, incl.
      label contrast (light-cyan system names) against it.
- [ ] run tests — must pass before task 5.

### Task 5: Add a Station interior backdrop
- [ ] Read `PlanetScene.ts`'s `resolvePlanetBackdropKey()` + its lazy-load mount
      (L369-406+) as the pattern to mirror.
- [ ] Since generating new photographic station-interior art (ComfyUI pipeline,
      `tools/comfyui/asset_prompts.json`) is a separate external/creative step (see
      Post-Completion), implement a code-only interim backdrop: a full-bleed gradient/
      vignette `Graphics` fill keyed by `StationType` (reuse whatever color coding
      `stationArt.ts`'s `STATION_TEXTURE_PREFIX` already implies per type, or define a
      small `StationType → accent color` map alongside it), mounted in `StationScene`'s
      `renderMain()` before the existing panel box (L332-341), structured so a future
      real art asset can be dropped in behind the same resolver without further wiring
      changes (mirror `pickVariantKey`/lazy-load shape even though the interim result is
      a procedural gradient, not a texture).
- [ ] Write a new `src/tests/presentation/StationScene.test.ts` (none exists yet) — at
      minimum: `renderMain()` mounts a full-bleed backdrop node before the panel box, and
      the backdrop's color varies by `StationType`.
- [ ] Screenshot-verify: Station no longer reads as a bare panel on black void.
- [ ] run tests — must pass before task 6.

### Task 6: Style the star-map critical-threat banner
- [ ] Rework `StarMapScene.ts:453-472` (`warningIndicator`): route it through
      `scaledText`/`scaledFont` (per `src/presentation/CLAUDE.md`, StarMapScene is
      explicitly listed as not-yet-migrated — do this only for the line(s) touched
      here, not a full-file migration), increase weight/size relative to the routine
      stat lines above it, and add a bordered/filled background chip so it reads as a
      banner, not a stray line of red text.
- [ ] Gate any animated emphasis (e.g. a subtle pulse) on `!isReducedMotionSet()`
      (`ui/reducedMotion.ts`) per the existing accessibility seam — do not add
      unconditional per-frame animation.
- [ ] Write a unit test asserting the warning line's font size/weight differ from the
      routine stat lines, and that pulse animation is skipped when reduced-motion is set.
- [ ] Screenshot-verify the banner reads as urgent against the (now-fixed, if Task 4
      applied) dark background.
- [ ] run tests — must pass before task 7.

### Task 7: Unify Planet/Station action-menu button chrome
- [ ] Run `gitnexus impact UiButton` before editing (shared component — root CLAUDE.md
      blast-radius rule).
- [ ] Replace `StationScene.ts`'s bare-bracket `scaledText` action rows (L439-469) with
      the shared `UiButton` component, following `PlanetScene.ts`'s `makeServiceBtn()`
      (L1302-1348) as the pattern — same bordered dark-navy chrome, accent color per
      action, same blocked/disabled treatment for `blocked` rows (L441).
- [ ] Preserve existing StationScene behavior exactly other than the visual chrome: same
      click handlers, same hover/cursor gating, same label text.
- [ ] Update/extend `src/tests/presentation/StationScene.test.ts` (created in Task 5) to
      assert action rows render via `UiButton` instances, not raw `Text`.
- [ ] Screenshot-verify Station's menu now visually matches Planet's button style.
- [ ] run tests — must pass before task 8.

### Task 8: Differentiate Station's non-actionable status rows
- [ ] In `StationScene.ts`'s `serviceButton()` (L537-587) and the render loop
      (L439-466), extend the existing `blocked` gate (currently only
      `isHostile && svc !== "leave"`, L441) to also cover non-actionable rows — e.g.
      hull-repair/refuel rows where the relevant `missing <= 0` — routing them through
      the same `eventMode="none"` / non-interactive / dimmer-but-distinct styling branch
      already used for `blocked`, so they stop showing pointer cursor and hover-alpha
      feedback.
- [ ] Ensure this doesn't change behavior for genuinely actionable rows or the
      `blocked`-due-to-hostile case — only adds a new "already satisfied, nothing to do"
      branch.
- [ ] Write a unit/real-engine test: a fully-repaired, fully-fueled station visit
      renders "Корпус в норме"/"Баки полны" as non-interactive (no click handler fires,
      `eventMode !== "static"`), while an actionable row (e.g. damaged hull) stays
      interactive.
- [ ] Screenshot-verify the visual distinction (dimmer, no bracket-hover affordance) is
      legible.
- [ ] run tests — must pass before task 9.

### Task 9: Bank loan-terms preview (contingent on Task 1)
- [ ] If Task 1 confirmed the loan-terms block is genuinely blank pre-loan through real
      navigation: trace `BankScene.ts` mount timing (`renderLoanTerms()` L300-371, the
      `engine`/`player` null guard at L308, and `BankSceneHost.ts`'s mount sequence) to
      find why `loanTermsSummary()`'s output isn't reaching the panel in the reproduced
      case, and fix the root cause (likely a timing/null-guard issue, not a missing
      calculation — the calc + its test coverage already exist and look correct).
- [ ] If Task 1 refuted this (confirmed already-populated, matching existing
      `loanTermsSummary`/`loanPanelLines` test coverage): mark this task's boxes `[x]`
      with a note "not applicable — confirmed non-issue in Task 1, no code change", and
      skip to Task 10.
- [ ] (If fixing) Write a regression test reproducing the exact blank-state path found
      (likely in `src/tests/banking/bankSceneView.test.ts` or a new BankScene mount
      test) before fixing.
- [ ] (If fixing) Screenshot-verify the terms populate correctly on first open.
- [ ] run tests — must pass before task 10.

### Task 10: HUD icon-button tooltips and label clarity
- [ ] Extend the existing hover-tooltip pattern already used by the star-map icon
      button (`FlightHud.ts` `starMapTooltip`, L791-811) to the `[I]` (inventory) button
      and, if still missing, the top-right contextual-help `[?]` button
      (`mountSceneHelp.ts`) — a short Russian label on hover ("Инвентарь", etc.).
- [ ] If Task 1's screenshots show `[I]` still reads as meaningfully lower-affordance
      than `[КВЕСТЫ]` despite identical code styling (i.e., it's a label-length/legibility
      issue, not a color/weight bug), consider widening the label (e.g.
      `[ИНВЕНТАРЬ]`) — check this against the layout-lock test
      `src/tests/presentation/flightHud.test.ts` first and only change if it doesn't
      break the pinned geometry; otherwise the tooltip alone is the fix.
- [ ] Write/extend `flightHud.test.ts` asserting the new tooltip(s) mount and show the
      expected text on `pointerover` / hide on `pointerout`.
- [ ] Screenshot-verify (hover state requires a real interaction, not a static capture —
      drive a synthetic `pointerover` in the test or via a live browser check).
- [ ] run tests — must pass before task 11.

### Task 11: Fix Взлёт/Взятка button spacing
- [ ] In `PlanetScene.ts`'s `computePlanetMenuLayout()` (L189-209), add extra vertical
      clearance specifically before the danger (`Взлёт`) and bribe (`Взятка`) rows
      rather than globally changing `btnStep`/`btnH` for every row (avoid regressing
      the general no-overlap layout other button counts rely on).
- [ ] Extend `src/tests/presentation/planetSceneUtils.test.ts:56-114`
      (`computePlanetMenuLayout` tests) with a new assertion: the gap between the last
      two rows (danger + bribe) is at least as large as the existing minimum, across the
      same screen-height/button-count matrix the existing tests already cover.
- [ ] Screenshot-verify the two buttons no longer read as cramped.
- [ ] run tests — must pass before task 12.

### Task 12: Fix main-menu "Новая игра" button color
- [ ] In `MainMenuScene.ts`, pass an explicit color to the `createButton()` call for
      "Новая игра" (L443-445) instead of relying on the `0x00ff00` default (L413) — pick
      a cyan consistent with the existing family (`0x88ddff`/`0x66ccff` used by
      Сохранения/Настройки/etc.), or a slightly brighter cyan if the primary action
      should still read as visually distinct from secondary actions.
- [ ] Write a unit test asserting the "Новая игра" button's fill color is in the cyan
      family, not green (extend `src/tests/presentation/mainMenuNewGame.test.ts` or
      `mainMenuVisuals.test.ts`).
- [ ] Screenshot-verify the main menu reads as one consistent accent family.
- [ ] run tests — must pass before task 13.

### Task 13: Verify acceptance criteria
- [ ] Re-verify finding #13 (decorative planet icons) is closed via Task 1's evidence —
      no code change expected; confirm no regression was introduced elsewhere.
- [ ] Re-capture all 8 original screenshots (MAIN_MENU, SPACE_FLIGHT, PLANET, TRADE,
      EQUIPMENT_SHOP, BANK, STATION, STAR_MAP) via real click-through navigation this
      time, and diff against the original findings list — confirm each of the 13 is
      either fixed or documented as a verified non-issue.
- [ ] Run full unit test suite (`npm test -- --run`) — all green.
- [ ] Run real-engine playtest suite (`npm run test:playtest`) — all green.
- [ ] Run `npm run letsplay:ci` — no new oddities introduced by the visual/layout
      changes (balance/asset/visual-variety invariants).
- [ ] Run linter (`npm run lint`) — all issues fixed.
- [ ] Run `gitnexus detect_changes({scope: "compare", base_ref: "master"})` — confirm
      only expected symbols/scenes are affected.

### Task 14: [Final] Update documentation
- [ ] Update `src/presentation/CLAUDE.md` if this plan established a new reusable
      pattern worth documenting (e.g. the Station backdrop resolver mirroring
      `resolvePlanetBackdropKey`, the shared encounter/trade reason-localization
      helper, the tooltip pattern extended beyond the star-map button).
- [ ] Update `.claude/docs/systems/banking.md` if Task 2's ledger-reason localization
      helper is a durable seam worth documenting there.
- [ ] No `README.md` change expected (internal UX polish, not a user-facing feature
      addition).

## Technical Details

- **Screenshot pipeline** (for verification steps, not committed code): a small local
  HTTP receiver (`python3 http.server`-based) plus
  `app.renderer.extract.base64({ target: app.stage, frame: app.renderer.screen })`
  executed via the Chrome extension's JS-exec tool, POSTed as a data URL and decoded to
  PNG. This is a debugging aid for this plan's execution, not a code deliverable.
- **Save compatibility:** Task 2 changes only how *new* ledger reason strings are
  built; existing saves' historical entries remain byte-identical (already-persisted
  text), so no `SaveStateSchema`/`MigrationPipeline`/`CURRENT_VERSION` change applies.
  No other task in this plan touches persisted domain fields.
- **No `GearCatalog`/domain schema changes** anywhere in this plan — pure
  presentation-layer styling/text/wiring fixes.

## Post-Completion

**Manual verification:**
- Full manual click-through of all 8 screens on a real display (color contrast,
  legibility) — screenshots are a good proxy but not a substitute for eyes-on review,
  especially for the star-map contrast question in Task 4/6.
- Hover-state QA for Task 10's new tooltips (mouse hover isn't fully exercisable by the
  static screenshot pipeline used elsewhere in this plan).

**External system updates:**
- Generate real station-interior panorama art via the ComfyUI pipeline
  (`tools/comfyui/asset_prompts.json` + the existing `pickVariantKey`/manifest
  convention) to replace Task 5's interim gradient backdrop — an external, human-in-the-
  loop creative step per the project's ComfyUI workflow, not automatable in this plan.
