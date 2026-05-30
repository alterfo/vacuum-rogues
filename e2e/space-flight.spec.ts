import { test, expect } from '@playwright/test';

test.describe('Space Flight Scene', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display space flight scene on flight button click', async ({ page }) => {
    // Wait for main menu to load
    await expect(page.getByText('КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ')).toBeVisible();

    // Click flight button
    await page.getByText('Полёт').click();

    // Verify space flight scene is displayed
    await expect(page.getByText('Кликните, чтобы переместить корабль')).toBeVisible();
    await expect(page.getByText('[НАЗАД К КАРТЕ]')).toBeVisible();
  });

  test('should return to star map from space flight', async ({ page }) => {
    // Navigate to space flight
    await page.getByText('КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ').waitFor({ state: 'visible' });
    await page.getByText('Полёт').click();

    // Click back to star map
    await page.getByText('[НАЗАД К КАРТЕ]').click();

    // Verify star map is displayed
    await expect(page.getByText('SECTOR MAP')).toBeVisible();
  });

  test('should show parallax stars in background', async ({ page }) => {
    await page.getByText('КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ').waitFor({ state: 'visible' });
    await page.getByText('Полёт').click();

    // Verify canvas is rendered
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Canvas should have content (non-zero dimensions)
    const canvasSize = await canvas.boundingBox();
    expect(canvasSize?.width).toBeGreaterThan(0);
    expect(canvasSize?.height).toBeGreaterThan(0);
  });
});
