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
 */
export async function applyMockHeavySystems(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__mockONNX = true;
    (window as Record<string, unknown>).__skipAudio = true;
    (window as Record<string, unknown>).__fastAnimations = true;
  });
}

/** Wait until window.__gameEngine is available and player exists */
export async function waitForEngine(page: Page, timeout = 15000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as Record<string, unknown>;
      const engine = w.__gameEngine as { player: unknown } | undefined;
      return engine != null;
    },
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
