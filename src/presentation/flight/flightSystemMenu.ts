import { SceneType } from "@/types";

import type { GameEngine } from "@/systems/GameEngine";
import type { FlightHud } from "./FlightHud";

/**
 * Wire the always-available in-flight system menu's two escape actions to the
 * engine. The menu + its confirm UI live in the HUD; the scene only owns these
 * thin callbacks (DIP), which keeps `SpaceFlightScene` under its line guard and
 * gives the wiring a single, unit-testable source of truth.
 *
 * - «Загрузить сохранение» raises a confirm (the current run is discarded), then
 *   loads the `"auto"` slot via the existing {@link GameEngine.loadGame} — which
 *   owns its own scene transition, so calling it from flight is safe.
 * - «В главное меню» leaves to {@link SceneType.MAIN_MENU}.
 *
 * Both engine methods are async; we deliberately fire-and-forget (`void`) — the
 * HUD/scene have nothing to await and `loadGame` drives the transition itself.
 *
 * «Загрузить сохранение» is gated on an existing save: we seed availability now
 * and re-check it whenever the menu opens ({@link FlightHud.onSystemMenuOpen}),
 * because the take-off autosave is written *after* `transitionTo` initialises the
 * scene — so the first menu open can find a save the init seed missed. No save ⇒
 * the HUD dims the action with a hint instead of offering a dead button.
 */
export function wireFlightSystemMenu(
  hud: FlightHud,
  gameEngine: GameEngine | null,
): void {
  hud.onLoadSave = () =>
    hud.showSystemMenuConfirm(() => {
      // Gated on hasSave(), but that returns true for *any* slot while we load
      // the "auto" slot specifically — a missing/corrupt auto slot resolves
      // `false` (no throw, no transition) and a vanished slot can reject. Handle
      // both so the player never lands silently back on the dead-end.
      void gameEngine
        ?.loadGame("auto")
        .then((ok) => {
          // On success loadGame drives its own transition (HUD already torn
          // down); only the failure branch still has a live HUD to toast.
          if (!ok) hud.showMessage("Не удалось загрузить сохранение", 0xff4444);
        })
        .catch(() => {
          hud.showMessage("Не удалось загрузить сохранение", 0xff4444);
        });
    });
  // MAIN_MENU is NOT in transitionTo's gameEngine auto-inject list, so the
  // context must be passed explicitly — otherwise MainMenuScene boots with a
  // null engine and both «Новая игра»/«Продолжить» are dead.
  hud.onMainMenu = () =>
    void gameEngine
      ?.transitionTo(SceneType.MAIN_MENU, { gameEngine })
      ?.catch(() => {
        hud.showMessage("Не удалось вернуться в меню", 0xff4444);
      });

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
