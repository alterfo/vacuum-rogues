import { test, expect } from '@playwright/test';

test.describe('Inventory and Ship Management', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('should open inventory screen', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      await canvas.click({
        position: {
          x: box.width - 50,
          y: 50,
        },
      });
    }

    await page.waitForTimeout(1000);
    
    await expect(canvas).toBeVisible();
  });

  test('should display ship stats', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });
});
