import type { GameScene } from "@/presentation/GameScene";
import type { Renderer } from "@/presentation/Renderer";
import type { SceneType } from "@/types";

/**
 * Port for scene instantiation.
 * Follows Creator GRASP pattern: factory knows how to create scenes.
 */
export interface ISceneFactory {
  createScene(type: SceneType, renderer: Renderer): GameScene | null;
}
