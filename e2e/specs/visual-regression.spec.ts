/**
 * Visual Regression Tests
 *
 * These tests capture screenshots of key game screens and compare them
 * against baseline images to detect unintended visual changes.
 *
 * Usage:
 * - First run creates baseline screenshots in e2e/specs/visual-regression.spec.ts-snapshots/
 * - Subsequent runs compare against baselines
 * - Update baselines with: npx playwright test visual-regression --update-snapshots
 */

import { test, expect } from '@playwright/test';
import { MainMenuPage } from '../page-objects/MainMenuPage';

test.describe('Visual Regression Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('main menu renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();

    // Wait for animations to settle
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('main-menu.png', {
      maxDiffPixels: 100, // Allow minor differences (antialiasing, etc.)
      threshold: 0.2, // 20% threshold for pixel comparison
    });
  });

  test('race selection screen renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();
    await mainMenu.clickNewGame();

    // Wait for race selection to appear
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('race-selection.png', {
      maxDiffPixels: 150,
      threshold: 0.2,
    });
  });

  test('space flight scene renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();
    await mainMenu.clickNewGame();

    // Select race and start game
    await page.waitForTimeout(500);
    await page.locator('text=ЧЕЛОВЕК').click();
    await page.locator('text=НАЧАТЬ ИГРУ').click();

    // Wait for space flight scene to load
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot('space-flight.png', {
      maxDiffPixels: 500, // More tolerance for dynamic elements (stars, etc.)
      threshold: 0.3,
    });
  });

  test('star map renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();
    await mainMenu.clickNewGame();

    // Select race and start game
    await page.waitForTimeout(500);
    await page.locator('text=ЧЕЛОВЕК').click();
    await page.locator('text=НАЧАТЬ ИГРУ').click();

    // Wait for space flight scene
    await page.waitForTimeout(2000);

    // Open star map
    await page.locator('text=МЕЖЗВЕЗДНАЯ КАРТА').click();

    // Wait for star map to render
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('star-map.png', {
      maxDiffPixels: 300,
      threshold: 0.25,
    });
  });

  test('inventory screen renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();
    await mainMenu.clickNewGame();

    // Select race and start game
    await page.waitForTimeout(500);
    await page.locator('text=ЧЕЛОВЕК').click();
    await page.locator('text=НАЧАТЬ ИГРУ').click();

    // Wait for space flight scene
    await page.waitForTimeout(2000);

    // Open inventory (press I or click button)
    await page.keyboard.press('i');

    // Wait for inventory to render
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('inventory.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });
});

test.describe('UI Component Regression', () => {
  test('planet info panel renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForReady();
    await mainMenu.clickNewGame();

    // Select race and start game
    await page.waitForTimeout(500);
    await page.locator('text=ЧЕЛОВЕК').click();
    await page.locator('text=НАЧАТЬ ИГРУ').click();

    // Wait for space flight scene
    await page.waitForTimeout(2000);

    // Click on a planet to show info panel
    // Note: This depends on planet positions which may vary
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 400, y: 300 } });

    await page.waitForTimeout(500);

    // Screenshot just the info panel area (right side of screen)
    await expect(page).toHaveScreenshot('planet-info-panel.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      clip: { x: 800, y: 0, width: 400, height: 600 },
    });
  });
});
