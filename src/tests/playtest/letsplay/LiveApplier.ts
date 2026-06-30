/**
 * Dev-only autopilot — the live-scene action applier.
 *
 * The headless {@link PlayerAgent} maps an abstract {@link Action} onto the real
 * engine through the {@link RealEngineHarness}; the **autopilot** does the same
 * thing for the *live, rendered* game. {@link applyLiveAction} is the pure
 * decision half of that: given the chosen `Action` and the current
 * {@link Observation}, it dispatches to the right verb on a {@link LiveSceneController}
 * — a thin port over the live `SpaceFlightScene`/`GameEngine` (route to a planet/
 * station, land/dock, open the market + buy/sell, take a board quest, warp,
 * attack/flee, repair, or just let a frame pass).
 *
 * It is deliberately **pure logic over a port**: it never imports PixiJS or the
 * real scene, so it is unit-tested against a mocked controller (each `Action`
 * kind → the expected verb; an action that is illegal for the current scene is a
 * safe no-op). The concrete controller that actually drives the live scene is
 * wired up dev-only in the autopilot toggle (a later task) — exactly the same
 * `observe → policy.decide → applyLiveAction` loop the harness runs, but over the
 * rendered game.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import { SceneType } from "@/types";
import type { Action } from "./PlayerPolicy";
import type { Observation } from "./observe";

/**
 * The verbs the autopilot can drive on the live game. A thin port so the pure
 * {@link applyLiveAction} dispatcher never touches PixiJS / the real scene: the
 * autopilot toggle implements this over the live `SpaceFlightScene`/`GameEngine`,
 * while tests implement it as a spy. Methods may be sync or async; the applier
 * awaits each so a scene transition completes before the next decision.
 */
export interface LiveSceneController {
  /** Advance one frame / let real time pass (the universal "do nothing yet"). */
  tick(): void | Promise<void>;
  /** Back out of a sub-screen toward the flight scene (the "leave this panel"). */
  leaveToFlight(): void | Promise<void>;
  /** Plot a course to and land on a planet (defaults to the nearest if absent). */
  land(planetId?: string): void | Promise<void>;
  /** Plot a course to and dock at a station (defaults to the nearest if absent). */
  dock(stationId?: string): void | Promise<void>;
  /** Open the galaxy/star map (the first half of a warp from flight). */
  openStarMap(): void | Promise<void>;
  /** Jump to a connected system (issued from the star map). */
  warp(systemId?: string): void | Promise<void>;
  /** Open the market for the current planet (the first half of a trade). */
  openTrade(planetId?: string): void | Promise<void>;
  /** Execute a buy/sell at the already-open market. */
  executeTrade(): void | Promise<void>;
  /** Accept the board quests offered at the current location. */
  takeQuest(): void | Promise<void>;
  /** Fire on a hostile in range (defaults to the nearest if absent). */
  attack(targetId?: string): void | Promise<void>;
  /** Disengage from combat. */
  flee(): void | Promise<void>;
  /** Restore hull at a repair-capable base. */
  repair(): void | Promise<void>;
}

/** Which controller verb {@link applyLiveAction} invoked (`"none"` when skipped). */
export type ApplyCall =
  | "tick"
  | "leaveToFlight"
  | "land"
  | "dock"
  | "openStarMap"
  | "warp"
  | "openTrade"
  | "executeTrade"
  | "takeQuest"
  | "attack"
  | "flee"
  | "repair"
  | "none";

/** The outcome of dispatching one {@link Action} onto the live controller. */
export interface ApplyResult {
  /** Whether a controller verb was actually invoked. */
  readonly applied: boolean;
  /** The verb invoked, or `"none"` when the action was skipped. */
  readonly call: ApplyCall;
  /** Why the action was skipped (only set when `applied` is false). */
  readonly reason?: string;
}

const skipped = (reason: string): ApplyResult => ({
  applied: false,
  call: "none",
  reason,
});

/**
 * Dispatch one chosen {@link Action} onto the live game via `controller`,
 * returning which verb ran (for the autopilot transcript / tests).
 *
 * Two safety gates keep this total and legal:
 *  - **Illegal action ⇒ no-op.** If `action.kind` is not in `obs.legalActions`
 *    (the scene can't perform it right now), nothing is driven and the result is
 *    `{ applied: false, call: "none" }`. The autopilot's policy is supposed to
 *    only ever pick a legal action, but the applier never trusts it.
 *  - **Scene-aware two-step verbs.** `move`/`trade`/`warp` mean different things
 *    by scene (fly vs. leave a panel; open a market vs. execute a sale; open the
 *    map vs. jump), resolved here from `obs.scene` exactly as the headless
 *    {@link PlayerAgent} applier does — so the live loop and the harness loop map
 *    actions identically.
 */
export async function applyLiveAction(
  action: Action,
  obs: Observation,
  controller: LiveSceneController,
): Promise<ApplyResult> {
  if (!obs.legalActions.includes(action.kind)) {
    return skipped(`illegal: ${action.kind} not in legalActions`);
  }

  switch (action.kind) {
    case "wait":
      await controller.tick();
      return { applied: true, call: "tick" };

    case "move": {
      // In flight, "move" is a frame of flying; on a sub-screen it backs out
      // toward the flight scene (the universal "leave this panel").
      if (obs.scene === SceneType.SPACE_FLIGHT) {
        await controller.tick();
        return { applied: true, call: "tick" };
      }
      await controller.leaveToFlight();
      return { applied: true, call: "leaveToFlight" };
    }

    case "land":
      await controller.land(action.targetId);
      return { applied: true, call: "land" };

    case "dock":
      await controller.dock(action.targetId);
      return { applied: true, call: "dock" };

    case "warp": {
      // Safety: if the ship is already flying to the system edge for a pending
      // jump, don't cancel it by re-opening the star map — just tick and wait.
      // This guards against the neural net picking "warp" while warpInTransit
      // is true (the heuristic returns "wait" for that, but the net may not).
      if (obs.warpInTransit) {
        await controller.tick();
        return { applied: true, call: "tick" };
      }
      // Two-step warp: from flight, open the galaxy map; from the map, jump.
      if (obs.scene !== SceneType.STAR_MAP) {
        await controller.openStarMap();
        return { applied: true, call: "openStarMap" };
      }
      await controller.warp(action.targetId);
      return { applied: true, call: "warp" };
    }

    case "trade": {
      // From a planet, open its market; once in the market, execute the buy/sell.
      if (obs.scene === SceneType.TRADE) {
        await controller.executeTrade();
        return { applied: true, call: "executeTrade" };
      }
      await controller.openTrade(action.targetId);
      return { applied: true, call: "openTrade" };
    }

    case "take-quest":
      await controller.takeQuest();
      return { applied: true, call: "takeQuest" };

    case "attack":
      await controller.attack(action.targetId);
      return { applied: true, call: "attack" };

    case "flee":
      await controller.flee();
      return { applied: true, call: "flee" };

    case "repair":
      await controller.repair();
      return { applied: true, call: "repair" };

    default:
      // Exhaustive over PlayerActionKind; an unknown kind degrades to a no-op.
      return skipped(`unhandled: ${(action as Action).kind}`);
  }
}
