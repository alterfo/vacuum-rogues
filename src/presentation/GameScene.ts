import type { Renderer } from "./Renderer";

export abstract class GameScene {
  protected renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  abstract initialize(context?: object): void;
  abstract update(deltaTime: number): void;
  abstract destroy(): void;

  persistLiveState?(): void;
}
