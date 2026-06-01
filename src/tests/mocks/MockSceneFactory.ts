import type { ISceneFactory } from "@/core/ports/ISceneFactory";
import type { GameScene } from "@/presentation/GameScene";
import type { Renderer } from "@/presentation/Renderer";
import type { SceneType } from "@/types";

/**
 * Mock implementation of ISceneFactory for testing.
 * Allows injecting mock scenes instead of real ones.
 */
export class MockSceneFactory implements ISceneFactory {
  private scenes = new Map<SceneType, GameScene>();
  public createCallCount = 0;
  public lastType?: SceneType;

  createScene(type: SceneType, _renderer: Renderer): GameScene | null {
    this.createCallCount++;
    this.lastType = type;
    return this.scenes.get(type) ?? null;
  }

  /** Test helper: register a mock scene for a type. */
  registerScene(type: SceneType, scene: GameScene): void {
    this.scenes.set(type, scene);
  }

  /** Test helper: clear registrations. */
  clear(): void {
    this.scenes.clear();
  }
}
