# E2E Reference — fixtures, gates, snapshots, harnesses

Look-up reference for `e2e/CLAUDE.md`. Read this when you hit a specific E2E
problem (a flaky snapshot, a missing fixture, choosing the right project to run).

## Playwright rules

- **No `canvas.click({ position: {x, y} })`** for normal flows — drive via
  `page.evaluate(() => window.__gameEngine.currentScene.handler())` or
  accessibility attributes. (Exception: interaction-regression smoke tests need
  real pointer events — see `e2e/CLAUDE.md`.)
- `page.evaluate` callbacks are **serialized** — they cannot close over
  spec-module scope. Install shared browser-side helpers on `window` via
  `addInitScript` and add a module-level `declare function` for TypeScript
  (see `e2e/letsplay-discovery.spec.ts` `getEngine`).
- No `waitForTimeout()` — use explicit waits (`waitForFunction`, `waitForSelector`).

## Helpers and fixtures

- Reusable helpers in `e2e/helpers/`: `GameDriver` (typed `__gameEngine`
  wrapper), `ErrorCollector` (JS error listener — always call
  `assertAndDetach()` at test end), `MonkeyTester` (seeded random input generator).
- Shared fixtures in `e2e/fixtures/mockHeavySystems.ts` — call
  `applyMockHeavySystems(page)` before `page.goto()` to stub ONNX, audio, and
  animations, and to hide the SpaceFlightScene nebula background (via
  `window.__hideFlightBackground`) in every E2E test.
- Scenes may expose `e2e*` methods so test drivers can bypass UI interactions.
  Guard with `if (__DEBUG__)` to strip them from production builds. When the
  clicked object is owned by a flight module, put the seam *on the module*
  (`NpcShipManager.e2eClickNpc`, `PlanetSprite.e2eMaskInfo`) and have the scene
  forward to it (Information Expert) — never reach into a module's sprites from
  the scene.

## CI gate (the `regression` project)

`npm run test:e2e:regression` runs the `regression` Playwright project, which
targets only `playtest-regression.spec.ts` — the fast gate for CI on every PR.
Keep PNG baselines OUT of this gate (see below).

## Visual snapshots

`expect(page.locator('canvas')).toHaveScreenshot('name.png', { maxDiffPixelRatio: 0.05 })`
— baselines committed per-spec under `e2e/<spec>.spec.ts-snapshots/`. Call
`SpaceFlightPage.freezeWorld()` before snapshotting for byte-determinism;
`settle(frames)` waits for a fresh composited frame. Baselines are
**platform-suffixed** (`*-chromium-darwin.png`) — gate visual tests with
`test.skip(process.platform !== 'darwin', …)`.

Pixel-**statistics** assertions ARE gate-safe: decode a `page.screenshot()`
clip with `pngjs` and assert a statistic (e.g. "≥95% of the planet's
bbox-corner clip is near-black background"). Platform-independent and the
sanctioned way to gate shader/rendering bugs in CI.

## Diagnostic harnesses

`e2e/letsplay-discovery.spec.ts` (full game loop with REAL visuals) and
`e2e/sun-band-exploration.spec.ts` (sun layer-toggle isolation) run only in the
`letsplay` Playwright project (`npx playwright test --project=letsplay`), never
in the default `chromium` suite. The letsplay run is the final arbiter for
visual fixes.
