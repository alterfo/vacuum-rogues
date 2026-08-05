import { test, expect } from '@playwright/test';

test.describe('ONNX Integration POC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ')).toBeVisible();
  });

  test('should show ONNX demo button in main menu', async ({ page }) => {
    await expect(page.getByText('ONNX Демо')).toBeVisible();
  });

  test('should attempt to load ONNX model', async ({ page }) => {
    await page.getByText('ONNX Демо').click();

    const message = await page.locator('text=/Загрузка|Модель|Инференс/').first();
    await expect(message).toBeVisible({ timeout: 10000 });
  });

  test('should handle model load failure gracefully', async ({ page }) => {
    await page.getByText('ONNX Демо').click();

    await page.waitForTimeout(5000);

    const messages = await page.locator('text=/Модель|Инференс/').allTextContents();
    expect(messages.length).toBeGreaterThan(0);
  });
});
