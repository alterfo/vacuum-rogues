# E2E Testing Conventions

## Playwright Rules

- Tests live in `e2e/`, Page Objects in `e2e/page-objects/`.
- **No `canvas.click({ position: {x, y} })`** — use `page.evaluate(() => window.__gameEngine.currentScene.handler())` or accessibility attributes.
- **EXCEPTION — interaction regressions REQUIRE real pointer events.** `e2e*` driver methods bypass PixiJS hit-testing and can never catch "button is mouse-dead" bugs. For hit-testing smoke tests, use `page.mouse.click(x, y)` with coordinates **derived from scene introspection** (`container.getGlobalPosition()`), never hardcoded. Note: `rootBoundary.rootTarget` is set lazily on the first mapped DOM event — dispatch one `page.mouse.move()` before calling `hitTest()` directly.
- `page.evaluate` callbacks are **serialized** — cannot close over spec-module scope. Install shared browser-side helpers on `window` via `addInitScript` and add a module-level `declare function` for TypeScript (see `e2e/letsplay-discovery.spec.ts` `getEngine`).
- No `waitForTimeout()` — use explicit waits (`waitForFunction`, `waitForSelector`).
- In dev/test mode, `window.__gameEngine` is exposed for test access.
- Reusable helpers in `e2e/helpers/`: `GameDriver` (typed `__gameEngine` wrapper), `ErrorCollector` (JS error listener — always call `assertAndDetach()` at test end), `MonkeyTester` (seeded random input generator).
- Shared fixtures in `e2e/fixtures/mockHeavySystems.ts` — call `applyMockHeavySystems(page)` before `page.goto()` to stub ONNX, audio, and animations, and to hide the SpaceFlightScene nebula background (via `window.__hideFlightBackground`) in every E2E test.
- The `regression` Playwright project (`npm run test:e2e:regression`) targets only `playtest-regression.spec.ts` — fast gate for CI on every PR.
- Scenes may expose `e2e*` methods to allow test drivers to bypass UI interactions. Guard with `if (__DEBUG__)` to strip from production builds. When the clicked object is owned by a flight module, put the seam *on the module* (`NpcShipManager.e2eClickNpc`, `PlanetSprite.e2eMaskInfo`) and have the scene forward to it (Information Expert) — never reach into a module's sprites from the scene.

## Visual Snapshots

`expect(page.locator('canvas')).toHaveScreenshot('name.png', { maxDiffPixelRatio: 0.05 })` — baselines committed per-spec under `e2e/<spec>.spec.ts-snapshots/`. Call `SpaceFlightPage.freezeWorld()` before snapshotting for byte-determinism; `settle(frames)` waits for a fresh composited frame. Baselines are **platform-suffixed** (`*-chromium-darwin.png`) — gate visual tests with `test.skip(process.platform !== 'darwin', …)`, keep PNG baselines OUT of the `regression` CI gate.

Pixel-**statistics** assertions ARE gate-safe: decode a `page.screenshot()` clip with `pngjs` and assert a statistic (e.g. "≥95% of the planet's bbox-corner clip is near-black background"). Platform-independent and the sanctioned way to gate shader/rendering bugs in CI.

## Diagnostic Harnesses

`e2e/letsplay-discovery.spec.ts` (full game loop with REAL visuals) and `e2e/sun-band-exploration.spec.ts` (sun layer-toggle isolation) run only in the `letsplay` Playwright project (`npx playwright test --project=letsplay`), never in the default `chromium` suite. The letsplay run is the final arbiter for visual fixes.

**Environment:** E2E runs need `NO_PROXY=localhost,127.0.0.1` (an http_proxy otherwise intercepts localhost).
