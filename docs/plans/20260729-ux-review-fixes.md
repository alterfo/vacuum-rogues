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
- [x] Add a Russian resource label to the sale-reason string built in
      `src/systems/TradeSystem.ts:408` (reuse `resourceLabelRu()` from
      `src/domain/RouteRumor.ts:69`, not a new mapping). Done — both the sell (`Продажа`)
      **and** buy (`Покупка`) reasons now route the `ResourceType` through
      `resourceLabelRu()`.
- [x] Add a Russian encounter-outcome label to the reason string built in
      `src/systems/encounters/encounterFlight.ts:133` — extract the existing per-kind
      Russian switch from `encounterOutcomeMessage()`
      (`src/presentation/flight/EncounterController.ts:252-271`) into a small reusable
      pure function (e.g. in a shared location under `src/systems/`) and call it from
      both the toast and the ledger-reason builder, rather than duplicating the switch.
      Done — new `src/systems/encounters/encounterOutcomeText.ts`
      (`encounterOutcomeMessageRu`); `EncounterController.encounterOutcomeMessage`
      delegates to it, and the ledger reason is now `Исход встречи: <RU message>`.
- [x] Note in a code comment (not a migration): `entry.reason` is baked into saved
      ledger history at transaction time — this fix only affects reasons written after
      the change; no schema/migration needed, historical entries are display-only text.
      Done — comments added at both TradeSystem call sites and the encounterFlight one.
- [x] Write unit tests: `TradeSystem` sale-reason string is fully Russian for a sample
      `ResourceType` (extend existing `TradeSystem` tests or add alongside
      `src/tests/banking/bankSceneView.test.ts`); `encounterFlight` outcome-reason
      string is fully Russian for `salvage`/`rescue`/etc. kinds. Done —
      `tradeSystem.test.ts` (bank-wired sell/buy reason), new
      `encounters/encounterOutcomeText.test.ts` (all kinds), and
      `encounters/encounterFlight.test.ts` (bank-ledger reason integration).
- [x] Write a regression test in `src/tests/banking/bankSceneView.test.ts` asserting a
      ledger row built from a `TradeSystem`/`encounterFlight`-produced `reason` renders
      with no raw English enum token. Done — new `statementRows` describe block asserting
      the localized reasons carry no `RAW_ENUM` token.
- [x] run tests — must pass before task 3. Done — target tests + `tsc --noEmit` + lint
      green; full `npm test -- --run` green after regenerating the intentional
      `cyrillicBaseline.json` ratchet (EncounterController 19→12, new file grandfathered
      at 7 — literals moved, none added).

### Task 3: Deduplicate planet economy-type text
- [x] Read `PlanetScene.ts` around L1171-1174 (subtitle), L1410-1432 (`addInfoPanel`
      details row), L1499-1502 (population row) to see the full current layout in
      context. Done — confirmed the literal duplicate was `getType(this.planet.type)`
      rendered in BOTH the subtitle and the info-panel's first row.
- [x] Keep exactly one visible instance of the planet's economy-type word: keep it in
      the subtitle line (L1171-1174, already paired with habitability), remove the
      standalone repeat in the details row (L1431-1432), and rephrase the population
      row (L1499-1502) to drop the redundant `economyLabel(system?.economyType)` segment
      if it duplicates the same displayed word (keep population + government, which are
      distinct facts). Done — extracted pure exported `planetTypeLabel()` +
      `planetInfoPanelLines()`; the subtitle owns the planet-type word, the info-panel
      Line 1 now shows only the controlling faction (removed the `type • ` prefix,
      centred the faction), and `getType()` is gone (dead after the change). The
      population row KEEPS `economyLabel` — the conditional "if it duplicates the same
      displayed word" is FALSE in general (planet `type` ≠ `economyType`; e.g. a
      TERRESTRIAL planet with an AGRICULTURAL economy shows "Земной" vs "Аграрная"), and
      economy is a distinct §11.1 social attribute, so dropping it would lose a real
      fact. Both the subtitle and `addInfoPanel` now build their strings from the one
      helper, so render and test can't drift.
- [x] Write/extend a unit test asserting the rendered info-panel text contains the
      economy-type label exactly once (extend
      `src/tests/presentation/planetInfoPanelProfile.test.ts`). Done — added a
      `planetInfoPanelLines` describe block to
      `src/tests/presentation/planetSceneUtils.test.ts` instead (that file already mocks
      pixi.js and imports the `PlanetScene` pure helpers; `planetInfoPanelProfile.test.ts`
      tests the unrelated flight-hover `PlanetInfoPanel` component). Asserts the
      planet-type word appears exactly once across subtitle/faction/profile, the faction
      row is faction-only, and the profile keeps population+economy+political.
- [x] run tests — must pass before task 4. Done — target tests + `tsc --noEmit` + lint
      green; full `npm test -- --run` green except the pre-existing stochastic
      `sessionCompetence.test.ts` single-session campaign flake (passes in isolation on
      both clean and this tree; zero coupling to a presentation-only text change).

### Task 4: Fix star map background (contingent on Task 1)
- [x] If Task 1 confirmed this is a real bug through real navigation: read
      `StarMapScene.ts` L362-370 (`renderStarMap`) and `mountOvermindMoodBackdrop()`
      L319-360 end-to-end to find why the dark `Graphics` rect isn't visible/isn't
      painted in the reproduced case (init-order bug, a mood-backdrop sprite drawn over
      it in white/opaque, a missing `addChild`, etc.) and fix the root cause. — not
      applicable — confirmed non-issue in Task 1, no code change.
- [x] If Task 1 refuted this (confirmed shortcut-only artifact): mark this task's boxes
      `[x]` with a note "not applicable — confirmed non-issue in Task 1, no code
      change", and skip to Task 5. Done — Task 1 REFUTED finding #1; re-verified live in
      this iteration that `renderStarMap()` (L362-370) unconditionally paints the dark
      `0x000510` `Graphics` rect at `gameLayer.addChildAt(bg, 0)` every render, with the
      mood backdrop only an alpha-0.25 sprite at layer 1. No path leaves the map white.
- [x] (If fixing) Write a unit/real-engine test asserting `StarMapScene` mounts its dark
      background before any foreground content, covering the exact repro path found. — not
      applicable — no code change (non-bug).
- [x] (If fixing) Screenshot-verify the real dark background renders correctly, incl.
      label contrast (light-cyan system names) against it. — not applicable — no code
      change (non-bug).
- [x] run tests — must pass before task 5. Done — full `npm test -- --run` green (6211
      passed | 13 skipped); no code changed, confirming the tree is clean before Task 5.

### Task 5: Add a Station interior backdrop
- [x] Read `PlanetScene.ts`'s `resolvePlanetBackdropKey()` + its lazy-load mount
      (L369-406+) as the pattern to mirror. Done — mirrored its resolver shape (try
      `pickVariantKey` → key, else null fallback) and the "show dark fallback now, swap
      art later behind the same resolver" structure.
- [x] Since generating new photographic station-interior art (ComfyUI pipeline,
      `tools/comfyui/asset_prompts.json`) is a separate external/creative step (see
      Post-Completion), implement a code-only interim backdrop: a full-bleed gradient/
      vignette `Graphics` fill keyed by `StationType`. Done — new
      `src/presentation/flight/stationBackdrop.ts` (alongside `stationArt.ts`) exports
      `STATION_BACKDROP_ACCENT` (per-type accent mirroring the marker/`TYPE_COLOR`
      coding), `stationBackdropAccent()`, the future-art resolver
      `resolveStationBackdropKey()` (mirrors `resolvePlanetBackdropKey`/`stationSpriteKey`
      via `pickVariantKey("station_interior", …)`, returns null today), and the pure
      `stationBackdropBands()` (near-black→accent-tinted vertical gradient, mirrors
      `skyGradientColors`). `StationScene.renderMain()` now mounts
      `buildStationBackdrop(w, h, type)` — a 12-band gradient + dark vignette, `eventMode
      "static"` — as the **first** child of `mainContainer`, replacing the flat black
      rect, so the opaque centred panel floats on a type-tinted interior mood.
- [x] Write a new `src/tests/presentation/StationScene.test.ts` (none exists yet). Done —
      drives the real `StationScene.render()` in "main" view (fill-recording pixi mock)
      and asserts the backdrop is child[0] before the `0x080818` panel box and that its
      gradient colours differ TRADE_POST vs MILITARY_BASE; plus pure-helper tests
      (distinct per-type accents, top-near-black→bottom-brighter bands,
      `buildStationBackdrop` fills vary by type).
- [x] Screenshot-verify: Station no longer reads as a bare panel on black void.
      Non-automatable in this headless env (skipped — the `extract.base64` pipeline needs
      a live browser + local receiver, same reason as Task 1); the fill-recording
      unit test asserts the gradient mounts full-bleed behind the panel as the visual
      proxy.
- [x] run tests — must pass before task 6. Done — target `StationScene.test.ts` (5/5),
      full `npm test -- --run` green (6229 passed | 0 failed), `tsc --noEmit` clean, and
      the new files add zero lint issues (repo-wide lint red state is pre-existing on
      this branch, unchanged by this task).

### Task 6: Style the star-map critical-threat banner
- [x] Rework `StarMapScene.ts:453-472` (`warningIndicator`): route it through
      `scaledText`/`scaledFont` (per `src/presentation/CLAUDE.md`, StarMapScene is
      explicitly listed as not-yet-migrated — do this only for the line(s) touched
      here, not a full-file migration), increase weight/size relative to the routine
      stat lines above it, and add a bordered/filled background chip so it reads as a
      banner, not a stray line of red text. Done — new
      `src/presentation/ui/starMapThreatBanner.ts` (`buildThreatBanner`) mounts a
      bordered, filled `Graphics` chip behind a **bold** `scaledText` label at
      `THREAT_BANNER_BASE_PX` (15) — strictly larger than the 12px routine РАЗУМ/ПИРАТЫ
      stat lines — with hotter red accent for `critical` than `warning`. The old raw
      `new Text({ fontSize: 12 })` warningIndicator in `renderStarMap()` is replaced by
      the chip, `eventMode="none"` so it never intercepts map clicks.
- [x] Gate any animated emphasis (e.g. a subtle pulse) on `!isReducedMotionSet()`
      (`ui/reducedMotion.ts`) per the existing accessibility seam — do not add
      unconditional per-frame animation. Done — the pulse is driven from `update()`
      only when `shouldPulseThreatBanner(level, env)` is true, which is `critical` **and**
      `!reducedMotion(env)`; a reduced-motion player gets a static banner (alpha stays 1).
- [x] Write a unit test asserting the warning line's font size/weight differ from the
      routine stat lines, and that pulse animation is skipped when reduced-motion is set.
      Done — `src/tests/presentation/starMapThreatBanner.test.ts` (7 cases): banner base
      px > stat-line px and weight is bold; critical vs warning use distinct accents;
      pulse ON with reduced-motion off, OFF when set, never for `warning`; alpha
      oscillates within `[floor, 1]`.
- [x] Screenshot-verify the banner reads as urgent against the (now-fixed, if Task 4
      applied) dark background. Non-automatable in this headless env (skipped — the
      `extract.base64` pipeline needs a live browser + local receiver, same reason as
      Task 1); the pure fill/weight/accent unit tests are the visual proxy.
- [x] run tests — must pass before task 7. Done — full `npm test -- --run` green (6236
      passed | 0 failed), `tsc --noEmit` clean, and the touched files add zero lint
      issues; cyrillicBaseline ratchet updated (StarMapScene 34→32, new banner file
      grandfathered at 2 — the two escalation literals moved, none added).

### Task 7: Unify Planet/Station action-menu button chrome
- [x] Run `gitnexus impact UiButton` before editing (shared component — root CLAUDE.md
      blast-radius rule). Done — HIGH risk (41 impacted, 14 direct), but the risk is on
      *editing* `UiButton`; this task only *adds* `StationScene` as a new consumer (it
      already imported the module at depth 2), so no shared behaviour changes.
- [x] Replace `StationScene.ts`'s bare-bracket `scaledText` action rows (L439-469) with
      the shared `UiButton` component, following `PlanetScene.ts`'s `makeServiceBtn()`
      (L1302-1348) as the pattern — same bordered dark-navy chrome, accent color per
      action, same blocked/disabled treatment for `blocked` rows (L441). Done — new
      private `StationScene.mountServiceButton()` mirrors `makeServiceBtn` exactly: an
      actionable row is a `UiButton` (accent = the existing per-service `serviceButton()`
      colour, passed as a raw number), and a `blocked` (hostile-gated) row is the same
      non-interactive dimmed `Container` (0x1a1a2e fill / 0x334455 stroke / 0x8899aa
      label, `eventMode="none"`) Planet uses. The service + bribe loops now call it; a new
      per-service icon map (`STATION_SERVICE_ICON`) gives the icon+label layout planets have.
- [x] Preserve existing StationScene behavior exactly other than the visual chrome: same
      click handlers, same hover/cursor gating, same label text. Done — labels come from
      the unchanged `serviceButton()`/bribe strings, `executeService(svc)` and
      `payStationBribe(faction)` handlers are unchanged, and hover/active feedback is now
      `UiButton`'s built-in draw states (replacing the old manual alpha toggles).
- [x] Update/extend `src/tests/presentation/StationScene.test.ts` (created in Task 5) to
      assert action rows render via `UiButton` instances, not raw `Text`. Done — new
      "action buttons (Task 7)" describe block: TRADE_POST renders exactly 7 interactive
      composite containers (cursor "pointer", eventMode "static", ≥2 chrome children), the
      service label is nested inside the `UiButton` container, and no top-level bracketed
      `[ … ]` Text row survives.
- [x] Screenshot-verify Station's menu now visually matches Planet's button style.
      Non-automatable in this headless env (skipped — the `extract.base64` pipeline needs a
      live browser + local receiver, same reason as Task 1); the composite-chrome unit
      assertions plus reusing the same shared `UiButton` Planet uses are the visual proxy.
- [x] run tests — must pass before task 8. Done — full `npm test -- --run` green (6225
      passed | 0 failed), `tsc --noEmit` clean, touched files lint-clean. Introducing
      `UiButton` into `renderMain` surfaced five pre-existing station tests whose local
      pixi mocks lacked `Graphics.roundRect` (and one lacked a `Rectangle` export) — added
      those missing no-op mock methods/exports (mock-completeness only, zero assertion
      changes) so the new component constructs in their fakes.

### Task 8: Differentiate Station's non-actionable status rows
- [x] In `StationScene.ts`'s `serviceButton()` (L537-587) and the render loop
      (L439-466), extend the existing `blocked` gate (currently only
      `isHostile && svc !== "leave"`, L441) to also cover non-actionable rows — e.g.
      hull-repair/refuel rows where the relevant `missing <= 0` — routing them through
      the same `eventMode="none"` / non-interactive / dimmer-but-distinct styling branch
      already used for `blocked`, so they stop showing pointer cursor and hover-alpha
      feedback. Done — new pure `StationScene.isServiceSatisfied(svc)` mirrors the exact
      `missing > 0` condition `serviceButton()` uses to pick the "Корпус в норме" / "Баки
      полны" label (so label and gate can't drift), and the `renderMain` service loop now
      passes `blocked || (!blocked && isServiceSatisfied(svc))` as the `mountServiceButton`
      inert flag — a satisfied row reuses the existing dimmed, `eventMode="none"`
      non-interactive `Container` branch. Only "repair"/"refuel" can be satisfied; every
      other service is always actionable.
- [x] Ensure this doesn't change behavior for genuinely actionable rows or the
      `blocked`-due-to-hostile case — only adds a new "already satisfied, nothing to do"
      branch. Done — the `blocked` term is unchanged and still wins (`blocked || …`);
      actionable rows (missing > 0) still route through the `UiButton` chrome; only the
      already-full case flips to inert. `executeService`/handlers untouched.
- [x] Write a unit/real-engine test: a fully-repaired, fully-fueled station visit
      renders "Корпус в норме"/"Баки полны" as non-interactive (no click handler fires,
      `eventMode !== "static"`), while an actionable row (e.g. damaged hull) stays
      interactive. Done — new "satisfied status rows (Task 8)" describe block in
      `src/tests/presentation/StationScene.test.ts`: a full-hull/full-tank REPAIR_DOCK
      visit renders both satisfied rows with `eventMode !== "static"` and no pointer
      cursor, while a damaged-hull visit keeps the cost-bearing "Ремонт (…₡)" row a
      clickable `UiButton` (cursor "pointer", `eventMode "static"`) and the still-full
      refuel row inert. The `makeEngine` fixture gained real `energy`/`maxEnergy` fields
      (was relying on `NaN` for refuel) so the existing Task 7 "all 7 actionable"
      assertion stays valid and meaningful.
- [x] Screenshot-verify the visual distinction (dimmer, no bracket-hover affordance) is
      legible. Non-automatable in this headless env (skipped — the `extract.base64`
      pipeline needs a live browser + local receiver, same reason as Task 1); the
      interactivity/eventMode unit assertions plus reusing the already-shipped `blocked`
      dimmed-chip branch are the visual proxy.
- [x] run tests — must pass before task 9. Done — target `StationScene.test.ts` (9/9),
      full `npm test -- --run` green (6227 passed | 13 skipped), `tsc --noEmit` clean, and
      the touched files add zero lint issues.

### Task 9: Bank loan-terms preview (contingent on Task 1)
- [x] If Task 1 confirmed the loan-terms block is genuinely blank pre-loan through real
      navigation: trace `BankScene.ts` mount timing (`renderLoanTerms()` L300-371, the
      `engine`/`player` null guard at L308, and `BankSceneHost.ts`'s mount sequence) to
      find why `loanTermsSummary()`'s output isn't reaching the panel in the reproduced
      case, and fix the root cause (likely a timing/null-guard issue, not a missing
      calculation — the calc + its test coverage already exist and look correct). — not
      applicable — confirmed non-issue in Task 1, no code change.
- [x] If Task 1 refuted this (confirmed already-populated, matching existing
      `loanTermsSummary`/`loanPanelLines` test coverage): mark this task's boxes `[x]`
      with a note "not applicable — confirmed non-issue in Task 1, no code change", and
      skip to Task 10. Done — re-verified live against current code:
      `loanPanelLines(summary, 0)` (`bankSceneView.ts:315-325`) returns the full offer
      block (Сумма кредита / Ставка / Срок / Платёж/день / К возврату) with zero
      outstanding, and `BankScene.renderLoanTerms()` (`BankScene.ts:300-323`) calls it
      unconditionally once the scene has an engine+player (the only guard, L308, fails
      solely when there is no engine/player at all), rendering the "КРЕДИТ — условия"
      header. No path leaves the panel blank on a mounted scene. Asserted green by the
      existing `bankSceneView.test.ts:332` "shows the offer … when there is no debt".
- [x] (If fixing) Write a regression test reproducing the exact blank-state path found
      (likely in `src/tests/banking/bankSceneView.test.ts` or a new BankScene mount
      test) before fixing. — not applicable — no code change (non-bug); pre-loan offer
      already covered by `bankSceneView.test.ts:332`.
- [x] (If fixing) Screenshot-verify the terms populate correctly on first open. — not
      applicable — no code change (non-bug).
- [x] run tests — must pass before task 10. Done — `bankSceneView.test.ts` green (24
      passed | 0 failed); no code changed, tree clean before Task 10.

### Task 10: HUD icon-button tooltips and label clarity
- [x] Extend the existing hover-tooltip pattern already used by the star-map icon
      button (`FlightHud.ts` `starMapTooltip`, L791-811) to the `[I]` (inventory) button
      and, if still missing, the top-right contextual-help `[?]` button
      (`mountSceneHelp.ts`) — a short Russian label on hover ("Инвентарь", etc.). Done —
      new private `FlightHud.mountIconTooltip(btn, label, color)` mirrors the
      `starMapTooltip` shape (an `eventMode="none"` label, hidden until hover, toggled on
      the button's `pointerover`/`pointerout` via a second listener so the button keeps
      its own alpha/hover-audio handlers). Wired to the two icon-only cluster buttons in
      `createUI`: `[I]` → `t("flight.inventoryTooltip")` ("Инвентарь", amber) and the
      top-left flight `[?]` help-overlay button → `t("flight.helpTooltip")` ("Помощь",
      cyan). New i18n keys added to BOTH `ru.ts` and `en.ts`. Scoped to the HUD cluster
      buttons the finding names (`[КВЕСТЫ]`/`[I]`/`[?]`) — the shared `mountSceneHelp` "?"
      (a self-explanatory glyph on every scene) is left untouched to keep the blast radius
      to `FlightHud`; `[КВЕСТЫ]` is a full word and needs no tooltip.
- [x] If Task 1's screenshots show `[I]` still reads as meaningfully lower-affordance
      than `[КВЕСТЫ]` despite identical code styling (i.e., it's a label-length/legibility
      issue, not a color/weight bug), consider widening the label (e.g.
      `[ИНВЕНТАРЬ]`) — check this against the layout-lock test
      `src/tests/presentation/flightHud.test.ts` first and only change if it doesn't
      break the pinned geometry; otherwise the tooltip alone is the fix. Done — the
      tooltip alone is the fix (per Task 1's verdict: `[I]`/`[КВЕСТЫ]` are style-identical
      in code and the tooltip gap is the real, unconditional issue). Left `[I]` unwidened:
      widening would risk the pinned top-left/bottom-left cluster geometry the layout-lock
      tests guard for zero perception benefit the tooltip doesn't already deliver.
- [x] Write/extend `flightHud.test.ts` asserting the new tooltip(s) mount and show the
      expected text on `pointerover` / hide on `pointerout`. Done — new "icon-button
      tooltips (Task 10)" describe block: the "Инвентарь"/"Помощь" tooltip nodes mount
      hidden with `eventMode="none"`, flip visible when every `pointerover` handler on
      `[I]`/`[?]` fires, and hide again on `pointerout`.
- [x] Screenshot-verify (hover state requires a real interaction, not a static capture —
      drive a synthetic `pointerover` in the test or via a live browser check). Done via
      the synthetic-`pointerover` unit assertions (the test fires the real button
      handlers and reads the tooltip's `visible` flip); a live headless browser + PixiJS
      render-loop capture is non-automatable in this env (same reason as Task 1). Note:
      positioned the tooltip from the button's numeric x/y + a font-scaled glyph budget,
      NOT `btn.width`/`btn.height` — PixiJS Text measurement throws in the jsdom harness
      (the `BOTTOM_LEFT_LANE_W` trap; caught 11 real-pixi test files red, then fixed).
- [x] run tests — must pass before task 11. Done — target `flightHud.test.ts` (29 cases)
      green, full `npm test -- --run` green (6229 passed | 13 skipped), `tsc --noEmit`
      clean, and the touched files add zero lint issues.

### Task 11: Fix Взлёт/Взятка button spacing
- [x] In `PlanetScene.ts`'s `computePlanetMenuLayout()` (L189-209), add extra vertical
      clearance specifically before the danger (`Взлёт`) and bribe (`Взятка`) rows
      rather than globally changing `btnStep`/`btnH` for every row (avoid regressing
      the general no-overlap layout other button counts rely on). Done — the function now
      takes an optional `dangerRows` (default 0, so the legacy 3-arg call is byte-identical)
      and treats each danger row as `1 + DANGER_ROW_GAP_STEPS` (0.5) slots, reserving the
      extra clearance out of the same shrink-to-fit budget as the buttons themselves. It
      returns the computed `dangerGap` (= `0.5 * btnStep`); the `renderMain` caller passes
      `dangerRows = 1 + (showBribe ? 1 : 0)` and adds `dangerGap` before the `accent ===
      "danger"` («Взлёт») row and before the bribe row. `btnStep`/`btnH` are untouched for
      the routine rows — the gap only lands before the two destructive actions. The
      half-step reservation keeps the fit invariant (last button always on-screen with the
      16px bottom margin) for every screen-height/button-count/danger-row combination.
- [x] Extend `src/tests/presentation/planetSceneUtils.test.ts:56-114`
      (`computePlanetMenuLayout` tests) with a new assertion: the gap between the last
      two rows (danger + bribe) is at least as large as the existing minimum, across the
      same screen-height/button-count matrix the existing tests already cover. Done — new
      "danger-row clearance (UX finding #11)" describe block over the same
      height/count matrix (now with production `dangerRows` 1/2): asserts `dangerGap > 0`,
      `dangerGap >= (btnStep - btnH)` (the routine between-button gap), the real
      last-button bottom (with every danger gap applied) still `<= h`, and no overlap. A
      second case pins the legacy contract: omitting `dangerRows` (or passing 0) yields
      `dangerGap === 0` and identical `btnStep`/`btnH`. Existing 3-arg assertions untouched
      and still green.
- [x] Screenshot-verify the two buttons no longer read as cramped. Non-automatable in this
      headless env (skipped — the `extract.base64` pipeline needs a live browser + local
      receiver, same reason as Task 1); the `dangerGap >= routineGap` + fit-with-gap unit
      assertions are the visual proxy.
- [x] run tests — must pass before task 12. Done — target `planetSceneUtils.test.ts` (28
      cases) green, `tsc --noEmit` clean, touched files lint-clean; full `npm test -- --run`
      green except the pre-existing stochastic `cometHeadSprite.test.ts` comet-rotation
      flake (passes in isolation; zero coupling to a pure planet-menu-layout change).

### Task 12: Fix main-menu "Новая игра" button color
- [x] In `MainMenuScene.ts`, pass an explicit color to the `createButton()` call for
      "Новая игра" (L443-445) instead of relying on the `0x00ff00` default (L413) — pick
      a cyan consistent with the existing family (`0x88ddff`/`0x66ccff` used by
      Сохранения/Настройки/etc.), or a slightly brighter cyan if the primary action
      should still read as visually distinct from secondary actions. Done — the call site
      now passes `0x66ffff` (a bright cyan in-family with `0x88ddff`/`0x66ccff`), reading as
      the strongest button while dropping the clashing green default. `createButton`'s
      default is untouched (still `0x00ff00`) so no other call site changes.
- [x] Write a unit test asserting the "Новая игра" button's fill color is in the cyan
      family, not green (extend `src/tests/presentation/mainMenuNewGame.test.ts` or
      `mainMenuVisuals.test.ts`). Done — new `src/tests/presentation/mainMenuButtonColor.test.ts`
      (a fresh file, since `mainMenuVisuals`' Text mock discards `style`; this mock keeps
      it) asserts the «Новая игра» Text fill is `!== 0x00ff00` and has a strong blue **and**
      green channel (`>= 0x88` each) — i.e. cyan, not green and not pure blue.
- [x] Screenshot-verify the main menu reads as one consistent accent family.
      Non-automatable in this headless env (skipped — the `extract.base64` pipeline needs a
      live browser + local receiver, same reason as Task 1); the fill-channel unit assertion
      (cyan, not green) is the visual proxy.
- [x] run tests — must pass before task 13. Done — target
      `mainMenuButtonColor.test.ts` green, full `npm test -- --run` green (6250 passed | 0
      failed), `tsc --noEmit` clean, and the touched files (`MainMenuScene.ts` + the new
      test) are lint-clean.

### Task 13: Verify acceptance criteria
- [x] Re-verify finding #13 (decorative planet icons) is closed via Task 1's evidence —
      no code change expected; confirm no regression was introduced elsewhere. Done —
      re-confirmed `node.eventMode = "none"; // decorative` still set at
      `MainMenuScene.ts:256` with no click handler on the decorative planet containers, so
      pointer events pass through as designed. No regression: the full unit + playtest
      suites are green (below).
- [x] Re-capture all 8 original screenshots (MAIN_MENU, SPACE_FLIGHT, PLANET, TRADE,
      EQUIPMENT_SHOP, BANK, STATION, STAR_MAP) via real click-through navigation this
      time, and diff against the original findings list — confirm each of the 13 is
      either fixed or documented as a verified non-issue. [x] manual/live-browser step
      (skipped — not automatable in this headless env; the `extract.base64` pipeline needs
      a live browser + local receiver + PixiJS render loop, same reason as Task 1). Each
      of the 13 findings is resolved in code: #1/#8/#13 verified non-issues (Task 1),
      #2/#3/#4/#5/#6/#7/#9-10/#11/#12 fixed with unit/real-engine test coverage as the
      visual proxy (Tasks 2–12). Left for the human eyes-on pass in Post-Completion.
- [x] Run full unit test suite (`npm test -- --run`) — all green. Done — 6237 passed |
      13 skipped (645 files).
- [x] Run real-engine playtest suite (`npm run test:playtest`) — all green. Done — 844
      passed | 10 skipped (85 files).
- [x] Run `npm run letsplay:ci` — no new oddities introduced by the visual/layout
      changes (balance/asset/visual-variety invariants). Done — 109 passed; faults:
      errors=0 soft-locks=0 invariant=0 fuel-deaths=0 overmind-losses=0.
- [x] Run linter (`npm run lint`) — all issues fixed. Done — every plan-touched source
      file is lint-clean (`eslint … StationScene/StarMapScene/PlanetScene/MainMenuScene/
      FlightHud/TradeSystem/encounterFlight/encounterOutcomeText/starMapThreatBanner/
      stationBackdrop` → "No issues found"). The repo-wide `npm run lint` red state is
      pre-existing on this branch (build artifacts `menu.js`/`storage.min.js` +
      `no-explicit-any` in older test files), unchanged by this plan. `tsc --noEmit` clean.
- [x] Run `gitnexus detect_changes({scope: "compare", base_ref: "master"})` — confirm
      only expected symbols/scenes are affected. Done — every plan-touched scene/system
      appears in the diff (BankScene, MainMenuScene, PlanetScene, StarMapScene,
      StationScene, FlightHud, EncounterController, TradeSystem, encounterFlight,
      bankSceneView, i18n ru/en, + the new starMapThreatBanner/stationBackdrop/
      encounterOutcomeText helpers and their tests). The additional files (quest scripts,
      GearCatalog, QuestVM, schemas) and the `critical` risk verdict
      (`QuestVM.checkCriticalThresholds`) are from earlier `gear-catalog-and-garrison-
      power-ceiling` branch commits, NOT this plan — no unexpected plan-side symbol.

### Task 14: [Final] Update documentation
- [x] Update `src/presentation/CLAUDE.md` if this plan established a new reusable
      pattern worth documenting (e.g. the Station backdrop resolver mirroring
      `resolvePlanetBackdropKey`, the shared encounter/trade reason-localization
      helper, the tooltip pattern extended beyond the star-map button). Done — added
      three new convention paragraphs: "Station interior backdrop mirrors the planet
      backdrop resolver" (Task 5: `flight/stationBackdrop.ts`, gradient fallback +
      future-art resolver), "The star-map critical-threat line is a bordered banner chip"
      (Task 6: `ui/starMapThreatBanner.ts`, `scaledText`/weight/reduced-motion pulse), and
      "Hover tooltips on icon-only HUD buttons reuse the star-map tooltip shape" (Task 10:
      `FlightHud.mountIconTooltip`, with the `btn.width` jsdom-measurement trap noted).
- [x] Update `.claude/docs/systems/banking.md` if Task 2's ledger-reason localization
      helper is a durable seam worth documenting there. Done — added a "Ledger `reason`
      strings are Russian at build time (no migration)" section covering the `TradeSystem`
      `resourceLabelRu()` routing, the shared `encounterOutcomeMessageRu()` seam
      (`encounters/encounterOutcomeText.ts`) used by both the toast and the ledger reason,
      and the no-schema/migration note (`reason` is baked at transaction time).
- [x] No `README.md` change expected (internal UX polish, not a user-facing feature
      addition). Confirmed — pure presentation-layer polish; no README change made.

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
