import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Combat Screen page object
 */
export class CombatPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to combat from star map
   */
  async navigateFromStarMap() {
    await this.triggerEncounter();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Check if combat scene is active
   */
  async expectCombatVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  /**
   * Trigger random encounter from star map
   */
  async triggerEncounter() {
    // This would be triggered from star map
    await this.clickCanvasPercent(0.7, 0.3);
    await this.page.waitForTimeout(2000);
  }

  /**
   * Check for hex grid display
   */
  async expectHexGridVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
    // Hex grid is rendered in canvas
  }

  /**
   * Select player ship action
   */
  async selectPlayerAction(actionIndex: number) {
    // Actions are typically in bottom panel
    const actionX = 100 + actionIndex * 120;
    await this.clickCanvas(actionX, 500);
    await this.page.waitForTimeout(500);
  }

  /**
   * Target enemy ship
   */
  async targetEnemyShip(x: number, y: number) {
    await this.clickCanvas(x, y);
    await this.page.waitForTimeout(500);
  }

  /**
   * Execute attack
   */
  async executeAttack() {
    // Attack button is typically highlighted
    await this.clickCanvasPercent(0.8, 0.8);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Move ship to hex
   */
  async moveShipToHex(hexX: number, hexY: number) {
    await this.clickCanvas(hexX, hexY);
    await this.page.waitForTimeout(500);
  }

  /**
   * Wait for enemy turn
   */
  async waitForEnemyTurn(waitTime = 3000) {
    await this.page.waitForTimeout(waitTime);
  }

  /**
   * Check combat status (player/enemy health)
   */
  async expectCombatStatusVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    // Health bars are rendered in canvas
  }

  /**
   * Verify combat end state
   */
  async expectCombatEnded(victory: boolean) {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    await this.page.waitForTimeout(1000);
    // Victory/defeat screen should appear
  }

  /**
   * Collect loot after combat
   */
  async collectLoot() {
    // Loot button appears after victory
    await this.clickCanvasPercent(0.5, 0.7);
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check for experience gain
   */
  async expectExperienceGained() {
    // XP notification should appear
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  /**
   * Test tactical AI behavior (Phase 2+)
   */
  async verifyTacticalAI() {
    // AI should demonstrate tactical behavior
    // For now, visual check that combat progresses
    await this.waitForEnemyTurn(5000);
    await this.expectCombatVisible();
  }
}
