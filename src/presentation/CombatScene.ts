import { GameScene } from './GameScene';
import { Graphics, Text } from 'pixi.js';
import type { TacticalEncounter } from '@/domain/TacticalEncounter';
import { logger } from '@/utils/logger';

export interface CombatContext {
  encounter: TacticalEncounter;
}

export class CombatScene extends GameScene {
  private _encounter?: TacticalEncounter;

  initialize(context?: object): void {
    const ctx = context as CombatContext | undefined;
    this._encounter = ctx?.encounter;
    void this._encounter;
    this.renderCombatGrid();
    logger.info('CombatScene initialized');
  }

  update(_deltaTime: number): void {
    // Combat animations
  }

  destroy(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
  }

  private renderCombatGrid(): void {
    this.renderer.clearGameLayer();

    const graphics = new Graphics();
    const hexSize = 24;
    const offsetX = 100;
    const offsetY = 80;

    for (let r = 0; r < 9; r++) {
      for (let q = 0; q < 9; q++) {
        const x = offsetX + q * hexSize * 1.8 + (r % 2) * hexSize * 0.9;
        const y = offsetY + r * hexSize * 1.5;

        graphics.stroke({ width: 1, color: 0x224466 });
        graphics.fill({ color: 0x0a1525 });

        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          points.push(x + hexSize * Math.cos(angle), y + hexSize * Math.sin(angle));
        }
        graphics.poly(points);
        graphics.fill(0x0a1525);
        graphics.stroke({ width: 1, color: 0x224466 });
      }
    }

    this.renderer.gameLayer.addChild(graphics);

    const title = new Text({
      text: 'TACTICAL COMBAT',
      style: {
        fontFamily: 'Courier New',
        fontSize: 20,
        fill: 0xff4444,
        letterSpacing: 3,
      },
    });
    title.x = 20;
    title.y = 20;
    this.renderer.uiLayer.addChild(title);
  }
}
