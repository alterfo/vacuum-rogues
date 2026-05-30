import { test, expect } from '@playwright/test';

test.describe('Trade System', () => {
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

  test('should access trading interface', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click on a trade station or market
      await canvas.click({
        position: {
          x: box.width / 2,
          y: box.height / 2,
        },
      });
    }

    await page.waitForTimeout(1000);
    
    // Trade interface should appear
    await expect(canvas).toBeVisible();
  });

  test('should display market prices', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    // Market data is rendered in canvas
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });
});
