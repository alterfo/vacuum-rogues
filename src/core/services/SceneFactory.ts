import type { ISceneFactory } from "@/core/ports/ISceneFactory";
import type { GameScene } from "@/presentation/GameScene";
import type { Renderer } from "@/presentation/Renderer";
import { SceneType } from "@/types";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { RaceSelectionScene } from "@/presentation/RaceSelectionScene";
import { StarMapScene } from "@/presentation/StarMapScene";
import { CombatScene } from "@/presentation/CombatScene";
import { DialogueScene } from "@/presentation/DialogueScene";
import { InventoryScene } from "@/presentation/InventoryScene";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { PlanetScene } from "@/presentation/PlanetScene";
import { TradeScene } from "@/presentation/TradeScene";
import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";
import { InfoCenterScene } from "@/presentation/InfoCenterScene";
import { StationScene } from "@/presentation/StationScene";
import { GovernmentScene } from "@/presentation/GovernmentScene";

/**
 * Factory for creating scene instances.
 * Follows Creator GRASP: central place for scene instantiation.
 * Follows OCP: new scene types are added here without changing GameEngine.
 */
export class SceneFactory implements ISceneFactory {
  createScene(type: SceneType, renderer: Renderer): GameScene | null {
    switch (type) {
      case SceneType.MAIN_MENU:
        return new MainMenuScene(renderer);
      case SceneType.RACE_SELECTION:
        return new RaceSelectionScene(renderer);
      case SceneType.STAR_MAP:
        return new StarMapScene(renderer);
      case SceneType.COMBAT:
        return new CombatScene(renderer);
      case SceneType.DIALOGUE:
        return new DialogueScene(renderer);
      case SceneType.INVENTORY:
        return new InventoryScene(renderer);
      case SceneType.SPACE_FLIGHT:
        return new SpaceFlightScene(renderer);
      case SceneType.PLANET:
        return new PlanetScene(renderer);
      case SceneType.TRADE:
        return new TradeScene(renderer);
      case SceneType.EQUIPMENT_SHOP:
        return new EquipmentShopScene(renderer);
      case SceneType.INFO_CENTER:
        return new InfoCenterScene(renderer);
      case SceneType.STATION:
        return new StationScene(renderer);
      case SceneType.GOVERNMENT:
        return new GovernmentScene(renderer);
      default:
        return null;
    }
  }
}
