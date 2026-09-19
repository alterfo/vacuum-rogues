import { type Page } from "@playwright/test";
import { GamePageBase } from "./base.page";

export class BlackHoleArcadeScenePage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async waitForActive(): Promise<void> {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>)
        .__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === "BlackHoleArcadeScene";
    });
  }
}
