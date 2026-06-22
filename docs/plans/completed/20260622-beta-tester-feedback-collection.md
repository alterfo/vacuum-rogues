---
# Beta-Tester Feedback Collection (In-Game → GitHub Issue Form)

## Overview
Give beta-testers of the deployed game (`alterfo.github.io/vacuum-rogues`, a static
GitHub Pages build) a one-click way to file structured feedback that lands in this
repo as a GitHub Issue. A **«Сообщить отзыв»** button opens a prefilled GitHub
**Issue Form** in a new tab, auto-capturing diagnostic context (build version, git
SHA, current scene, in-game day, galaxy seed) so each report is reproducible
without asking the tester for environment details. No backend, no secrets, no
tester-side setup beyond a GitHub account.

Pieces:
1. A GitHub **Issue Form** template (`beta-feedback.yml`) + chooser `config.yml`.
2. A **git-SHA build define** (`__BUILD_SHA__`) alongside the existing
   `__BUILD_VERSION__`, surfaced through a tiny `buildInfo` helper.
3. A **pure** `buildFeedbackUrl(...)` that composes the prefilled new-issue URL
   (repo slug `alterfo/vacuum-rogues`), unit-tested for encoding + field mapping.
4. An in-game **«Сообщить отзыв»** button (Main Menu + the in-flight system menu)
   that captures live context and opens the URL.

## Context
Files/components (confirmed by exploration):
- **Build defines:** `vite.config.ts` (~L55) injects `__DEBUG__` and
  `__BUILD_VERSION__` (`process.env.npm_package_version ?? 'dev'`); declared in
  `src/vite-env.d.ts` (~L17-18). No git SHA today. `package.json` version `0.1.0`.
- **Repo slug for the issue URL:** `alterfo/vacuum-rogues` (git remote origin).
- **No issue templates yet:** `.github/ISSUE_TEMPLATE/` does not exist.
- **Button homes:** `src/presentation/MainMenuScene.ts` has a `createButton`
  helper (~L340) in `buttonsContainer`. `src/presentation/flight/flightSystemMenu.ts`
  (the in-flight «Загрузить сохранение» / «В главное меню» menu) is the natural
  in-session home so a tester can report mid-run with live context.
- **Live context accessors:** galaxy seed originates in `GameEngine` (~L320,
  `config.seed ?? SR_<ts>`) — expose/read the active seed; current scene via the
  engine's scene state; in-game day via the flight day provider / `galaxy.gameDays`.
- **GitHub Issue Forms** support query-param prefill by field `id` plus
  `?template=beta-feedback.yml`; the diagnostics go into a dedicated prefilled field.

Standing rules:
- **Do NOT modify/weaken existing test assertions** — add new tests only.
- Keep the URL/format logic **pure and isolated** (`src/systems/feedback/`), free of
  PixiJS/DOM, so it is unit-tested standalone; scenes only capture context + open.
- `window.open(url, "_blank", "noopener")` for the outbound link.
- Visual button placement requires **screenshot verification**.
- `SpaceFlightScene.ts` stays < 1900 lines (logic in the menu helper, not the scene).

## Development Approach
- **TDD** for the pure URL builder + buildInfo formatting; **screenshot-verify** the
  in-game buttons. Run `gitnexus impact` on `MainMenuScene` button wiring and
  `flightSystemMenu` before editing; warn on HIGH/CRITICAL.
- Reuse the existing `createButton` / menu-entry patterns — do not fork new UI
  primitives. Complete each task (code + tests green) before the next.

## Implementation Steps

### Task 1: GitHub Issue Form + chooser config
**Files:**
- Create: `.github/ISSUE_TEMPLATE/beta-feedback.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

- [x] Author `beta-feedback.yml` (GitHub Issue Form) with fields: short summary
      (input), what happened / steps (textarea), expected vs actual (textarea),
      severity (dropdown: blocker/major/minor/cosmetic), and a **«Диагностика»**
      textarea (prefillable by query param; testers leave it as-is) plus default
      `labels: [beta-feedback]` and a title prefix.
- [x] Add `config.yml` with `blank_issues_enabled: false` and a contact link to the
      external fallback (optional) so the form is the default path.
- [x] Validate the YAML parses as a GitHub Issue Form (well-formed `body` field
      list with unique `id`s used by the prefill in Task 3).

### Task 2: Inject git SHA into the build + buildInfo helper
**Files:**
- Modify: `vite.config.ts` (add `__BUILD_SHA__` define)
- Modify: `src/vite-env.d.ts` (declare `__BUILD_SHA__`)
- Create: `src/systems/feedback/buildInfo.ts` (+ test)

- [x] Add `__BUILD_SHA__` define = `process.env.GITHUB_SHA` (CI) ?? a local
      `git rev-parse --short HEAD` ?? `'dev'`; declare the global in `vite-env.d.ts`.
- [x] Create `buildInfo.ts` exposing `{ version, sha }` and a `formatBuildLine()`
      reading the globals (guarded so tests can inject values).
- [x] write tests for `formatBuildLine()` (version+sha present; dev fallback).
- [x] run tests — green.

### Task 3: Pure feedback-URL builder
**Files:**
- Create: `src/systems/feedback/feedbackLink.ts` (+ test)

- [x] Implement `buildFeedbackUrl(ctx: { version; sha; scene; day; seed })` →
      `https://github.com/alterfo/vacuum-rogues/issues/new` with
      `template=beta-feedback.yml`, a title prefix, and the diagnostics field
      prefilled (URL-encoded multi-line: version, sha, scene, day, seed). Repo slug
      is a single named constant.
- [x] write tests: correct base URL + `template` param; diagnostics field carries
      every context value; proper percent-encoding of newlines/spaces/Cyrillic;
      stable field id matches the form from Task 1.
- [x] run tests — green.

### Task 4: In-game «Сообщить отзыв» button (Main Menu + in-flight menu)
**Files:**
- Modify: `src/presentation/MainMenuScene.ts` (menu button)
- Modify: `src/presentation/flight/flightSystemMenu.ts` (menu entry)
- Create/Modify tests under `src/tests/`

- [x] `gitnexus impact` on the touched menu wiring; confirm scope. (impact +
      `detect_changes` — scope = MainMenuScene + FlightHud only; medium risk, no
      surprises. The new opener seam lives in `src/systems/feedback/openFeedback.ts`.)
- [x] Add a «Сообщить отзыв» button to the Main Menu that builds the URL from
      `buildInfo` + last-known context (scene=MAIN_MENU, seed if a game exists) and
      opens it via `window.open(url, "_blank", "noopener")`. (`MainMenuScene.handleFeedback`
      → `openFeedback` → `openInNewTab`.)
- [x] Add a «Сообщить отзыв» entry to `flightSystemMenu` that captures **live**
      context (current scene, in-game day, galaxy seed) and opens the same URL —
      the high-value in-session path. (`FlightHud.onFeedback` wired in
      `wireFlightSystemMenu`; galaxy id embeds the seed.)
- [x] write a test that the menu wiring calls the opener with a URL produced by
      `buildFeedbackUrl` carrying the live context (inject a fake opener; assert the
      URL). Do not alter existing menu tests' assertions. (`inFlightMenuFeedback.test.ts`
      + `openFeedback.test.ts`; existing menu tests untouched.)
- [x] run tests — green; **capture a screenshot** of both buttons in place.
      (281 flight+feedback unit tests green; E2E `beta-feedback-button.spec.ts`
      captured `e2e/screenshots/{main-menu,in-flight}-feedback-button.png`.)

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] Issue Form renders on `…/issues/new?template=beta-feedback.yml` with the
      diagnostics prefilled when opened from the button (manual/live check).
      [manual test (skipped - not automatable): requires the deployed GitHub Pages
      site + a live GitHub session; the form YAML + prefill `id` are unit-covered.]
- [x] Both buttons open the prefilled issue in a new tab with correct context.
      [manual test (skipped - not automatable): the opener seam + URL are unit-tested
      (`inFlightMenuFeedback.test.ts`, `openFeedback.test.ts`) and both buttons are
      screenshot-verified (`e2e/screenshots/{main-menu,in-flight}-feedback-button.png`);
      opening a real browser tab is a live check.]
- [x] `detect_changes({scope:"compare", base_ref:"master"})` — only expected scope.
      (Branch is long-lived with many unrelated features, so the meaningful scope is
      the feature's own commits `b31a5f0..HEAD`: only the 2 Issue-Form YAMLs, the build
      defines `vite.config.ts`/`vite-env.d.ts`, the 3 `src/systems/feedback/` modules +
      tests, the `MainMenuScene`/`flightSystemMenu`/`FlightHud` menu surfaces, E2E spec +
      screenshots, and this plan. No surprise scope.)
- [x] full unit suite `npm test -- --run` green (incl. untouched assertions);
      `npm run lint` clean. (302 files / 2608 tests passed; lint 0 errors, 48
      pre-existing `any` warnings in test files.)

## Technical Details
- Everything is static-host-safe: the only network action is opening a GitHub URL
  in a new tab — no backend, no secret in the client.
- The Issue Form's diagnostics field is plain prefilled text, so even if a tester
  edits the form, build/seed/scene survive for triage.
- Severity dropdown + `beta-feedback` label make the issues triage-sortable.

## Post-Completion
*Manual / external (no checkboxes):*
- Repo settings: ensure Issues are enabled and the `beta-feedback` label exists
  (the form's `labels:` auto-creates it on first use).
- Optionally add a no-GitHub-account fallback (Tally/Google Form) as the
  `config.yml` contact link for non-technical testers.
- Share the deployed URL + a one-line "use the «Сообщить отзыв» button" note with testers.
