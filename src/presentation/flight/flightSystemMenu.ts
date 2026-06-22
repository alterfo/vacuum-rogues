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
    hud.showSystemMenuConfirm(() => void gameEngine?.loadGame("auto"));
  hud.onMainMenu = () => void gameEngine?.transitionTo(SceneType.MAIN_MENU);

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
