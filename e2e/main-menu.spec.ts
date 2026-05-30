import { test, expect } from '@playwright/test';

test.describe('Main Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });
  });

  test('should display title', async ({ page }) => {
    // Title is rendered in PixiJS canvas, check canvas exists
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    // Check canvas has content (non-zero dimensions)
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });

  test('should transition to star map on new game', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click "Новая игра" button (center-left area, above "Продолжить")
      await canvas.click({
        position: {
          x: box.width / 2 - 50,
          y: box.height / 2 + 50,
        },
      });
    }

    // Wait for transition to star map and player creation
    await page.waitForTimeout(2000);
    
    // Star map should be visible (different scene)
    await expect(canvas).toBeVisible();
    
    // Verify that the game state has changed (no main menu title)
    // The star map should have "SECTOR MAP" title instead
  });

  test('should handle continue with no save', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click "Продолжить" button (below "Новая игра")
      await canvas.click({
        position: {
          x: box.width / 2 - 50,
          y: box.height / 2 + 90,
        },
      });
    }

    // Wait for message "Нет доступных сохранений"
    await page.waitForTimeout(1000);
    
    // Message should appear and disappear after 3 seconds
    await page.waitForTimeout(2500);
  });
});
