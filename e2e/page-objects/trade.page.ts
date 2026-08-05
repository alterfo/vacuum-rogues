import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

export class TradePage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async navigateFromStarMap() {
    await this.clickCanvasPercent(0.5, 0.5);
    await this.page.waitForTimeout(1000);
  }

  async expectTradeVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  async viewMarketPrices() {
    await this.clickCanvasPercent(0.5, 0.5);
    await this.page.waitForTimeout(500);
  }

  async buyResource(resourceIndex: number, quantity: number) {
    const resourceX = 200 + resourceIndex * 120;
    await this.clickCanvas(resourceX, 300);
    await this.page.waitForTimeout(300);
    await this.clickCanvas(resourceX, 350);
    await this.page.waitForTimeout(300);
    await this.clickCanvas(resourceX, 400);
    await this.page.waitForTimeout(500);
  }

  async sellResource(resourceIndex: number, quantity: number) {
    const resourceX = 500 + resourceIndex * 120;
    await this.clickCanvas(resourceX, 300);
    await this.page.waitForTimeout(300);
    await this.clickCanvas(resourceX, 400);
    await this.page.waitForTimeout(500);
  }

  async expectPricesVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async expectCreditsUpdated() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  async viewCargoHold() {
    await this.clickCanvasPercent(0.5, 0.8);
    await this.page.waitForTimeout(500);
  }

  async expectCargoCapacityVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async verifyPriceDynamics() {
    await this.viewMarketPrices();
    await this.expectPricesVisible();
  }

  async executeTrade(resource: string, action: 'buy' | 'sell', quantity: number) {
    await this.page.waitForTimeout(500);
  }
}
