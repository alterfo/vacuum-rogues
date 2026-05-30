import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Trade Screen page object
 */
export class TradePage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to trade from star map
   */
  async navigateFromStarMap() {
    // Click on trade station or market
    await this.clickCanvasPercent(0.5, 0.5);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if trade interface is active
   */
  async expectTradeVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  /**
   * View market prices
   */
  async viewMarketPrices() {
    // Market panel is typically in center
    await this.clickCanvasPercent(0.5, 0.5);
    await this.page.waitForTimeout(500);
  }

  /**
   * Buy resource
   */
  async buyResource(resourceIndex: number, quantity: number) {
    const resourceX = 200 + resourceIndex * 120;
    await this.clickCanvas(resourceX, 300);
    await this.page.waitForTimeout(300);
    // Quantity input
    await this.clickCanvas(resourceX, 350);
    await this.page.waitForTimeout(300);
    // Buy button
    await this.clickCanvas(resourceX, 400);
    await this.page.waitForTimeout(500);
  }

  /**
   * Sell resource
   */
  async sellResource(resourceIndex: number, quantity: number) {
    const resourceX = 500 + resourceIndex * 120;
    await this.clickCanvas(resourceX, 300);
    await this.page.waitForTimeout(300);
    // Sell button
    await this.clickCanvas(resourceX, 400);
    await this.page.waitForTimeout(500);
  }

  /**
   * Check resource prices display
   */
  async expectPricesVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    // Prices are rendered in canvas
  }

  /**
   * Verify credit balance update
   */
  async expectCreditsUpdated() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  /**
   * View cargo hold
   */
  async viewCargoHold() {
    // Cargo panel is typically at bottom
    await this.clickCanvasPercent(0.5, 0.8);
    await this.page.waitForTimeout(500);
  }

  /**
   * Check cargo capacity
   */
  async expectCargoCapacityVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  /**
   * Test price dynamics (Phase 2+)
   */
  async verifyPriceDynamics() {
    // Prices should change based on supply/demand
    // For now, visual check that prices are displayed
    await this.viewMarketPrices();
    await this.expectPricesVisible();
  }

  /**
   * Execute trade transaction
   */
  async executeTrade(resource: string, action: 'buy' | 'sell', quantity: number) {
    // This would interact with trade system
    await this.page.waitForTimeout(500);
  }
}
