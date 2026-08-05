import { SceneType } from "@/types";
import { buildInfo } from "@/systems/feedback/buildInfo";
import {
  openFeedback,
  openInNewTab,
  type UrlOpener,
} from "@/systems/feedback/openFeedback";

import type { GameEngine } from "@/systems/GameEngine";
import type { FlightHud } from "./FlightHud";

export function wireFlightSystemMenu(
  hud: FlightHud,
  gameEngine: GameEngine | null,
  open: UrlOpener = openInNewTab,
): void {
  hud.onLoadSave = () =>
    hud.showSystemMenuConfirm(() => {
      void gameEngine
        ?.loadGame("auto")
        .then((ok) => {
          if (!ok) hud.showMessage("Не удалось загрузить сохранение", 0xff4444);
        })
        .catch(() => {
          hud.showMessage("Не удалось загрузить сохранение", 0xff4444);
        });
    });
  hud.onOpenSaveLoad = () =>
    void gameEngine
      ?.transitionTo(SceneType.SAVE_LOAD, {
        gameEngine,
        returnTo: SceneType.SPACE_FLIGHT,
      })
      ?.catch(() => {
        hud.showMessage("Не удалось открыть сохранения", 0xff4444);
      });

  hud.onMainMenu = () =>
    void gameEngine
      ?.transitionTo(SceneType.MAIN_MENU, { gameEngine })
      ?.catch(() => {
        hud.showMessage("Не удалось вернуться в меню", 0xff4444);
      });

  hud.onFeedback = () => {
    const { version, sha } = buildInfo();
    openFeedback(
      {
        version,
        sha,
        scene: gameEngine?.currentSceneType ?? SceneType.SPACE_FLIGHT,
        day: gameEngine?.galaxy?.gameDays ?? 0,
        seed: gameEngine?.galaxy?.id ?? "—",
      },
      open,
    );
  };

  const refreshSaveAvailability = () => {
    const saveManager = gameEngine?.saveManager;
    if (!saveManager) return;
    void saveManager
      .hasSave()
      .then((has) => hud.setLoadSaveEnabled(has))
      .catch(() => {
        /* a failed availability probe must not break the menu — leave as-is */
      });
  };
  hud.onSystemMenuOpen = refreshSaveAvailability;
  refreshSaveAvailability();
}
