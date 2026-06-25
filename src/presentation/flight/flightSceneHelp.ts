import type { Renderer } from "../Renderer";
import { mountSceneHelp, showHelpOnce } from "../ui/mountSceneHelp";

/**
 * The flight scene's contextual-help layer, extracted from `SpaceFlightScene` so
 * the controller stays under its line-count guard
 * (`docs/plans/20260623-onboarding-and-contextual-help.md`).
 *
 * On {@link mountFlightSceneHelp} it mounts, on `renderer.stage` (above the HUD,
 * surviving the scene's `uiLayer` rebuilds): the `welcome`/goal panel on the very
 * first flight, then the `SPACE_FLIGHT` controls hint on the next visit, plus the
 * always-available top-right «?» that reopens the flight hint. The returned handle
 * drives the one-shot `combat` hint (first in-flight engagement) and tears it all
 * down from the scene's `destroy()`.
 */
export interface FlightSceneHelp {
  /**
   * Show the one-shot `combat` hint the first time a fight engages. Call every
   * frame with the live combat-active flag: it fires on the rising edge (and the
   * `seen` store makes it one-shot ever), re-arming once the fight ends.
   */
  maybeShowCombatHint(combatActive: boolean): void;
  /** Tear down the help layer (first-time hint + «?» + combat hint). */
  destroy(): void;
}

/** Mount the flight scene's contextual help and return its lifecycle handle. */
export function mountFlightSceneHelp(renderer: Renderer): FlightSceneHelp {
  const helpTeardown = mountSceneHelp(
    { renderer, container: renderer.stage },
    "SPACE_FLIGHT",
    { firstTimeKey: "welcome" },
  );
  let combatHintTeardown: (() => void) | null = null;
  let combatHintArmed = false;

  return {
    maybeShowCombatHint(combatActive: boolean): void {
      if (!combatActive) {
        combatHintArmed = false;
        return;
      }
      if (combatHintArmed) return;
      combatHintArmed = true;
      combatHintTeardown = showHelpOnce(
        { renderer, container: renderer.stage },
        "combat",
      );
    },
    destroy(): void {
      helpTeardown();
      combatHintTeardown?.();
      combatHintTeardown = null;
      combatHintArmed = false;
    },
  };
}
