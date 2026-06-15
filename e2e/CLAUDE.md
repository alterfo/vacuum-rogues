# E2E Testing Conventions

Tests in `e2e/`, Page Objects in `e2e/page-objects/`. `window.__gameEngine` is exposed in
dev/test mode; reusable helpers in `e2e/helpers/`.

Two critical rules:
- **Interaction regressions REQUIRE real pointer events** — `page.mouse.click(x, y)` with
  coords from `container.getGlobalPosition()`, never hardcoded. `e2e*` driver methods bypass
  PixiJS hit-testing and can never catch "button is mouse-dead" bugs. Dispatch one
  `page.mouse.move()` before a direct `hitTest()` (rootTarget is set lazily).
- **E2E runs its own dev server on port 5175, not 5173** (`playwright.config.ts`) — don't
  rely on a running `npm run dev`. E2E also needs `NO_PROXY=localhost,127.0.0.1`.

Snapshot/helper/diagnostic-harness details live in the spec files and `e2e/helpers/`.
