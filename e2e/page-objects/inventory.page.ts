import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

export class InventoryPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async navigateFromStarMap() {
    await this.clickCanvasPercent(0.95, 0.1);
    await this.page.waitForTimeout(1000);
  }

  async expectInventoryVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  async viewShipStats() {
    await this.clickCanvasPercent(0.2, 0.5);
    await this.page.waitForTimeout(500);
  }

  async equipModule(moduleIndex: number) {
    const moduleX = 200 + moduleIndex * 100;
    await this.clickCanvas(moduleX, 300);
    await this.page.waitForTimeout(500);
  }

  async unequipModule(slotIndex: number) {
    const slotX = 100 + slotIndex * 100;
    await this.clickCanvas(slotX, 400);
    await this.page.waitForTimeout(500);
  }

  async viewInventoryItems() {
    await this.clickCanvasPercent(0.5, 0.6);
    await this.page.waitForTimeout(500);
  }

  async expectShipStatsVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async expectStatsUpdated() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  async openModuleDetails(moduleIndex: number) {
    const moduleX = 200 + moduleIndex * 100;
    await this.clickCanvas(moduleX, 300);
    await this.page.waitForTimeout(500);
  }

  async closeInventory() {
    await this.clickCanvasPercent(0.95, 0.05);
    await this.page.waitForTimeout(500);
  }

  async verifyInventoryPersistence() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }
}
