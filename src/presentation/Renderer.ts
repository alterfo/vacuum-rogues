import { Application, Container } from 'pixi.js';
import { logger } from '@/utils/logger';

export class Renderer {
  public app: Application;
  public readonly stage: Container;
  public readonly uiLayer: Container;
  public readonly gameLayer: Container;

  constructor(private container: HTMLElement) {
    this.app = new Application();
    this.stage = new Container();
    this.uiLayer = new Container();
    this.gameLayer = new Container();
  }

  async initialize(): Promise<void> {
    await this.app.init({
      resizeTo: this.container,
      backgroundColor: 0x000510,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Check for Canvas2D fallback (PixiJS v8 uses string type)
    const rendererType = (this.app.renderer as unknown as { type?: string }).type;
    if (rendererType === 'canvas') {
      logger.warn('Canvas2D fallback active - WebGL not available');
    } else {
      logger.info(`Renderer type: ${rendererType ?? 'unknown'}`);
    }

    this.container.appendChild(this.app.canvas as unknown as Node);

    this.stage.addChild(this.gameLayer);
    this.stage.addChild(this.uiLayer);
    this.app.stage.addChild(this.stage);

    logger.info('PixiJS renderer initialized');
  }

  resize(): void {
    this.app.renderer.resize(this.container.clientWidth, this.container.clientHeight);
  }

  clearGameLayer(): void {
    while (this.gameLayer.children.length > 0) {
      const child = this.gameLayer.children[0];
      this.gameLayer.removeChild(child);
      child.destroy();
    }
  }

  clearUILayer(): void {
    while (this.uiLayer.children.length > 0) {
      const child = this.uiLayer.children[0];
      this.uiLayer.removeChild(child);
      child.destroy();
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
