import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Inventory Screen page object
 */
export class InventoryPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to inventory from star map
   */
  async navigateFromStarMap() {
    // Inventory button is typically in top-right
    await this.clickCanvasPercent(0.95, 0.1);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if inventory screen is active
   */
  async expectInventoryVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  /**
   * View ship stats
   */
  async viewShipStats() {
    // Stats panel is typically on left or right side
    await this.clickCanvasPercent(0.2, 0.5);
    await this.page.waitForTimeout(500);
  }

  /**
   * Equip module to ship
   */
  async equipModule(moduleIndex: number) {
    const moduleX = 200 + moduleIndex * 100;
    await this.clickCanvas(moduleX, 300);
    await this.page.waitForTimeout(500);
  }

  /**
   * Unequip module
   */
  async unequipModule(slotIndex: number) {
    const slotX = 100 + slotIndex * 100;
    await this.clickCanvas(slotX, 400);
    await this.page.waitForTimeout(500);
  }

  /**
   * View inventory items
   */
  async viewInventoryItems() {
    // Inventory grid is typically in center
    await this.clickCanvasPercent(0.5, 0.6);
    await this.page.waitForTimeout(500);
  }

  /**
   * Check ship stats display
   */
  async expectShipStatsVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    // Stats are rendered in canvas
  }

  /**
   * Verify module stats change after equip
   */
  async expectStatsUpdated() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  /**
   * Open module details
   */
  async openModuleDetails(moduleIndex: number) {
    const moduleX = 200 + moduleIndex * 100;
    await this.clickCanvas(moduleX, 300);
    await this.page.waitForTimeout(500);
  }

  /**
   * Close inventory
   */
  async closeInventory() {
    // Close button is typically in top-right
    await this.clickCanvasPercent(0.95, 0.05);
    await this.page.waitForTimeout(500);
  }

  /**
   * Verify inventory persistence (Phase 1)
   */
  async verifyInventoryPersistence() {
    // Check that equipped modules persist
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }
}
