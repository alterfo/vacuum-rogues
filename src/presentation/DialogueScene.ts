import { GameScene } from './GameScene';
import { Graphics, Text } from 'pixi.js';
import type { DialogueSession } from '@/domain/DialogueSession';
import { logger } from '@/utils/logger';

export interface DialogueContext {
  session: DialogueSession;
}

export class DialogueScene extends GameScene {
  private session?: DialogueSession;

  initialize(context?: object): void {
    const ctx = context as DialogueContext | undefined;
    this.session = ctx?.session;
    this.renderDialogueUI();
    logger.info('DialogueScene initialized');
  }

  update(_deltaTime: number): void {
    // Dialogue UI animations
  }

  destroy(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
  }

  private renderDialogueUI(): void {
    this.renderer.clearGameLayer();

    const graphics = new Graphics();
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    // Dialogue panel background
    graphics.fill({ color: 0x001122, alpha: 0.85 });
    graphics.rect(40, h - 220, w - 80, 180);
    graphics.fill(0x001122);
    graphics.stroke({ width: 2, color: 0x00ffff });

    this.renderer.gameLayer.addChild(graphics);

    const npcName = this.session?.npc.name ?? 'Unknown';
    const title = new Text({
      text: `DIALOGUE: ${npcName}`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0x00ffff,
      },
    });
    title.x = 60;
    title.y = h - 210;
    this.renderer.uiLayer.addChild(title);
  }
}
