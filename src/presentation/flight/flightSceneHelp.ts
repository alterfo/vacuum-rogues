import type { Renderer } from "../Renderer";
import { mountSceneHelp, showHelpOnce } from "../ui/mountSceneHelp";

export interface FlightSceneHelp {
  maybeShowCombatHint(combatActive: boolean): void;
  destroy(): void;
}

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
      combatHintTeardown ??= showHelpOnce(
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
