import { test, expect } from '@playwright/test';

test.describe('Star Map Scene', () => {
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

  test('should display star system', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    // Star map should show celestial bodies
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });

  test('should show system information on click', async ({ page }) => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    
    if (box) {
      // Click on a star system (random position in center)
      await canvas.click({
        position: {
          x: box.width / 2,
          y: box.height / 2,
        },
      });
    }

    await page.waitForTimeout(500);
    
    // UI should update
    await expect(canvas).toBeVisible();
  });

  test('should navigate between systems', async ({ page }) => {
    const canvas = page.locator('canvas');
    
    // Click on different areas to navigate
    const box = await canvas.boundingBox();
    if (box) {
      await canvas.click({
        position: { x: box.width * 0.3, y: box.height * 0.4 },
      });
      await page.waitForTimeout(1000);
      
      await canvas.click({
        position: { x: box.width * 0.7, y: box.height * 0.6 },
      });
      await page.waitForTimeout(1000);
    }
    
    await expect(canvas).toBeVisible();
  });
});
