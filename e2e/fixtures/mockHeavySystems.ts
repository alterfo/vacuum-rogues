import type { Page } from '@playwright/test';

export async function applyMockHeavySystems(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__mockONNX = true;
    (window as Record<string, unknown>).__skipAudio = true;
    (window as Record<string, unknown>).__fastAnimations = true;
    (window as Record<string, unknown>).__hideFlightBackground = true;
  });
}

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
