import { test, expect } from '@playwright/test';

test.describe('Game Launch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the game page', async ({ page }) => {
    await expect(page).toHaveTitle(/Space Rangers|Космические рейнджеры/);
  });

  test('should display main menu screen', async ({ page }) => {
    await page.waitForSelector('canvas', { timeout: 10000 });
    
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('should have game container', async ({ page }) => {
    const gameContainer = page.locator('#game-container');
    await expect(gameContainer).toBeVisible();
  });

  test('should load workers without MIME type errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });
    
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(3000);
    
    const workerErrors = errors.filter(e => 
      e.includes('MIME type') || 
      e.includes('inference.worker') ||
      e.includes('Worker')
    );
    
    expect(workerErrors.length).toBe(0);
  });

  test('should start new game with player creation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });
    
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      await canvas.click({
        position: {
          x: box.width / 2 - 50,
          y: box.height / 2 + 50,
        },
      });
    }
    
    await page.waitForTimeout(2000);
    
    await expect(canvas).toBeVisible();
    
    const newBox = await canvas.boundingBox();
    expect(newBox?.width).toBeGreaterThan(0);
  });
});
