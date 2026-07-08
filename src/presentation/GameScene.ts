import type { Renderer } from "./Renderer";

export abstract class GameScene {
  protected renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  abstract initialize(context?: object): void;
  abstract update(deltaTime: number): void;
  abstract destroy(): void;

  /**
   * Flush any per-frame live state into domain objects before a save
   * serializes them. Default no-op — only scenes with derived live state that
   * isn't otherwise synced to the domain each frame need to override this
   * (e.g. `SpaceFlightScene` mirrors NPC sprite positions back onto their
   * domain ships here, so a page-hide reload mid-flight persists where NPCs
   * actually are, not their stale spawn position).
   */
  persistLiveState?(): void;
}
