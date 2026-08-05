import { test, expect } from '@playwright/test';

test.describe('Game Start Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display main menu', async ({ page }) => {
    await expect(page.getByText('КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ')).toBeVisible();
    await expect(page.getByText('НЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ')).toBeVisible();
  });

  test('should show all menu buttons', async ({ page }) => {
    await expect(page.getByText('Новая игра')).toBeVisible();
    await expect(page.getByText('Полёт')).toBeVisible();
    await expect(page.getByText('ONNX Демо')).toBeVisible();
  });

  test('should start new game and show star map', async ({ page }) => {
    await page.getByText('Новая игра').click();

    await expect(page.getByText('SECTOR MAP')).toBeVisible();
    await expect(page.getByText('Кликните на систему для информации')).toBeVisible();
  });

  test('should render game canvas', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const canvasSize = await canvas.boundingBox();
    expect(canvasSize?.width).toBeGreaterThan(0);
    expect(canvasSize?.height).toBeGreaterThan(0);
  });
});
