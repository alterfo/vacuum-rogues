import type { Page } from '@playwright/test';

/**
 * Injects browser-side flags that suppress heavy subsystems during E2E smoke
 * tests. Call addInitScript() BEFORE page.goto() so the flags are present
 * before main.ts runs.
 *
 * window.__mockONNX     — ONNXModelRegistry skips real model loading and
 *                         returns stub tensors from FallbackEngine
 * window.__skipAudio    — AudioManager no-ops all playback calls
 * window.__fastAnimations — tweens/lerp durations clamped to 1 frame
 * window.__hideFlightBackground — SpaceFlightScene.initialize() calls
 *                         e2eSetBackgroundVisible(false) so every flight test
 *                         renders against a clean black background (lightweight,
 *                         diff-friendly screenshots)
 */
export async function applyMockHeavySystems(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__mockONNX = true;
    (window as Record<string, unknown>).__skipAudio = true;
    (window as Record<string, unknown>).__fastAnimations = true;
    (window as Record<string, unknown>).__hideFlightBackground = true;
  });
}

/** Wait until window.__gameEngine is available (player may still be null at main menu) */
export async function waitForEngine(page: Page, timeout = 15000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as Record<string, unknown>;
      return w.__gameEngine != null;
    },
    undefined,
    { timeout },
  );
}

/** Wait until the active scene matches the given constructor name */
export async function waitForScene(
  page: Page,
  sceneName: string,
  timeout = 15000,
): Promise<void> {
  await page.waitForFunction(
    (name) => {
      const w = window as Record<string, unknown>;
      const engine = w.__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      } | undefined;
      return engine?.currentScene?.constructor.name === name;
    },
    sceneName,
    { timeout },
  );
}
