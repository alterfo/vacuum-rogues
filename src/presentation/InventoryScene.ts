import { GameScene } from './GameScene';
import { Graphics, Text } from 'pixi.js';
import type { Player } from '@/domain/Player';
import { logger } from '@/utils/logger';

export interface InventoryContext {
  player: Player;
}

export class InventoryScene extends GameScene {
  private player?: Player;

  initialize(context?: object): void {
    const ctx = context as InventoryContext | undefined;
    this.player = ctx?.player;
    this.renderInventoryUI();
    logger.info('InventoryScene initialized');
  }

  update(_deltaTime: number): void {
    // Inventory UI updates
  }

  destroy(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
  }

  private renderInventoryUI(): void {
    this.renderer.clearGameLayer();

    const graphics = new Graphics();
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    // Background panel
    graphics.fill({ color: 0x001122, alpha: 0.9 });
    graphics.rect(60, 60, w - 120, h - 120);
    graphics.fill(0x001122);
    graphics.stroke({ width: 2, color: 0x00ffaa });

    this.renderer.gameLayer.addChild(graphics);

    const title = new Text({
      text: 'INVENTORY & SHIP',
      style: {
        fontFamily: 'Courier New',
        fontSize: 20,
        fill: 0x00ffaa,
      },
    });
    title.x = 80;
    title.y = 80;
    this.renderer.uiLayer.addChild(title);

    if (this.player) {
      const credits = new Text({
        text: `Credits: ${this.player.credits}`,
        style: {
          fontFamily: 'Courier New',
          fontSize: 14,
          fill: 0xffff00,
        },
      });
      credits.x = 80;
      credits.y = 120;
      this.renderer.uiLayer.addChild(credits);
    }
  }
}
