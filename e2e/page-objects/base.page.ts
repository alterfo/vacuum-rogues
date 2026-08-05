import { type Page, expect } from '@playwright/test';

export class GamePageBase {
  constructor(protected page: Page) {}

  async waitForGameCanvas(timeout = 10000) {
    await this.page.waitForSelector('canvas', { timeout });
  }

  async getCanvasBox() {
    const canvas = this.page.locator('canvas');
    return await canvas.boundingBox();
  }

  async clickCanvas(x: number, y: number) {
    const box = await this.getCanvasBox();
    expect(box, 'Canvas should be present for clickCanvas').toBeTruthy();
    await this.page.locator('canvas').click({
      position: { x: box!.x + x, y: box!.y + y },
    });
  }

  async clickCanvasPercent(xPercent: number, yPercent: number) {
    const box = await this.getCanvasBox();
    expect(box, 'Canvas should be present for clickCanvasPercent').toBeTruthy();
    await this.page.locator('canvas').click({
      position: {
        x: box!.x + box!.width * xPercent,
        y: box!.y + box!.height * yPercent,
      },
    });
  }

  async waitForGameInitialization(waitTime = 3000) {
    await this.waitForGameCanvas();
    await this.page.waitForTimeout(waitTime);
  }

  async collectConsoleErrors(): Promise<string[]> {
    const errors: string[] = [];
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    return errors;
  }

  async expectNoCriticalErrors(
    excludedPatterns: string[] = []
  ): Promise<void> {
    const errors: string[] = [];
    const listener = (msg: { type: string; text: () => string }) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    };
    this.page.on('console', listener);

    await this.page.waitForTimeout(2000);

    this.page.off('console', listener);

    const criticalErrors = errors.filter(
      (e) =>
        !excludedPatterns.some((pattern) => e.includes(pattern)) &&
        !e.includes('favicon') &&
        !e.includes('MIME type')
    );

    expect(criticalErrors.length).toBe(0);
  }
}
