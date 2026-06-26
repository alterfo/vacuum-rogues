import { SceneType } from "@/types";
import { buildInfo } from "@/systems/feedback/buildInfo";
import {
  openFeedback,
  openInNewTab,
  type UrlOpener,
} from "@/systems/feedback/openFeedback";

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
 *
 * «Сообщить отзыв» captures **live** context (current scene, in-game day, galaxy
 * seed) and opens the prefilled GitHub Issue Form in a new tab. The opener is
 * injectable (`open`, defaults to {@link openInNewTab}) so the wiring is
 * unit-testable with a fake opener.
 */
export function wireFlightSystemMenu(
  hud: FlightHud,
  gameEngine: GameEngine | null,
  open: UrlOpener = openInNewTab,
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
  // «Сохранения» opens the full save/load screen (named manual slots — save /
  // overwrite / delete / load). `returnTo: SPACE_FLIGHT` drops the player back
  // into flight when they close it; transitionTo tears down this scene + HUD on
  // its own, so this is fire-and-forget like «В главное меню».
  hud.onOpenSaveLoad = () =>
    void gameEngine
      ?.transitionTo(SceneType.SAVE_LOAD, {
        gameEngine,
        returnTo: SceneType.SPACE_FLIGHT,
      })
      ?.catch(() => {
        hud.showMessage("Не удалось открыть сохранения", 0xff4444);
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

  // Snapshot live context at click time and open the prefilled Issue Form. The
  // galaxy id embeds the run seed (`galaxy_<seed>`), the day is the whole-day
  // calendar, and the scene is whatever the engine is showing (SPACE_FLIGHT here,
  // but read live so a future caller stays correct).
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
