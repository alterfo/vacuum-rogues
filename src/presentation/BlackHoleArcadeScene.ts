import { Container } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { logger } from "@/utils/logger";

interface BlackHoleArcadeContext {
  gameEngine?: GameEngine;
  returnSystemId?: string;
  blackHoleSystemId?: string;
}

export class BlackHoleArcadeScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private returnSystemId: string | null = null;
  private blackHoleSystemId: string | null = null;
  private container: Container | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as BlackHoleArcadeContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.returnSystemId = ctx?.returnSystemId ?? null;
    this.blackHoleSystemId = ctx?.blackHoleSystemId ?? null;

    this.container = new Container();
    this.renderer.gameLayer.addChild(this.container);
    logger.info("BlackHoleArcadeScene initialized", {
      hasEngine: this.gameEngine !== null,
      returnSystemId: this.returnSystemId,
      blackHoleSystemId: this.blackHoleSystemId,
    });
  }

  update(_deltaTime: number): void {}

  destroy(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.gameEngine = null;
    this.returnSystemId = null;
    this.blackHoleSystemId = null;
  }
}
