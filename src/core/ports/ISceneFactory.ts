import type { GameScene } from "@/presentation/GameScene";
import type { Renderer } from "@/presentation/Renderer";
import type { SceneType } from "@/types";

export interface ISceneFactory {
  createScene(type: SceneType, renderer: Renderer): GameScene | null;
}
