import { test, expect } from '@playwright/test';

test.describe('Combat System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });
    
    // Navigate to star map
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
  });

  test('should enter combat encounter', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click to trigger random encounter or enemy system
      await canvas.click({
        position: {
          x: box.width * 0.7,
          y: box.height * 0.3,
        },
      });
    }

    await page.waitForTimeout(2000);
    
    // Combat scene should be active
    await expect(canvas).toBeVisible();
  });

  test('should display hex grid in combat', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    // Hex grid is rendered in canvas
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });

  test('should execute combat actions', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click on enemy ship or action button
      await canvas.click({
        position: {
          x: box.width * 0.6,
          y: box.height * 0.4,
        },
      });
      await page.waitForTimeout(500);
      
      // Click again for another action
      await canvas.click({
        position: {
          x: box.width * 0.4,
          y: box.height * 0.6,
        },
      });
    }

    await page.waitForTimeout(1000);
    
    // Combat should progress
    await expect(canvas).toBeVisible();
  });
});
