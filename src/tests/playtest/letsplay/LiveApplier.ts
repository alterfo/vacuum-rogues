import { SceneType } from "@/types";
import type { Action } from "./PlayerPolicy";
import type { Observation } from "./observe";

export interface LiveSceneController {
  tick(): void | Promise<void>;
  dismissBlockingModal?(): boolean | Promise<boolean>;
  leaveToFlight(): void | Promise<void>;
  land(planetId?: string): void | Promise<void>;
  dock(stationId?: string): void | Promise<void>;
  openStarMap(): void | Promise<void>;
  warp(systemId?: string, reason?: string): void | Promise<void>;
  openTrade(planetId?: string): void | Promise<void>;
  executeTrade(): void | Promise<void>;
  takeQuest(): void | Promise<void>;
  attack(targetId?: string): void | Promise<void>;
  flee(): void | Promise<void>;
  repair(): void | Promise<void>;
  buyGear(): void | Promise<void>;
  upgradeHull(): void | Promise<void>;
  buyModule(): void | Promise<void>;
  takeLoan(): void | Promise<void>;
  repayLoan(): void | Promise<void>;
  sellCargo(): void | Promise<void>;
  armUp(): void | Promise<void>;
  liberate(): void | Promise<void>;
}

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
  | "buyGear"
  | "upgradeHull"
  | "buyModule"
  | "takeLoan"
  | "repayLoan"
  | "sellCargo"
  | "armUp"
  | "liberate"
  | "none";

export interface ApplyResult {
  readonly applied: boolean;
  readonly call: ApplyCall;
  readonly reason?: string;
}

const skipped = (reason: string): ApplyResult => ({
  applied: false,
  call: "none",
  reason,
});

export async function applyLiveAction(
  action: Action,
  obs: Observation,
  controller: LiveSceneController,
): Promise<ApplyResult> {
  if (!obs.legalActions.includes(action.kind)) {
    return skipped(`illegal: ${action.kind} not in legalActions`);
  }

  if (
    obs.warpInTransit &&
    action.kind !== "wait" &&
    action.kind !== "attack" &&
    action.kind !== "flee"
  ) {
    await controller.tick();
    return { applied: true, call: "tick" };
  }

  switch (action.kind) {
    case "wait":
      await controller.tick();
      return { applied: true, call: "tick" };

    case "move": {
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
      if (obs.scene !== SceneType.STAR_MAP) {
        await controller.openStarMap();
        return { applied: true, call: "openStarMap" };
      }
      await controller.warp(action.targetId, action.reason);
      return { applied: true, call: "warp" };
    }

    case "trade": {
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

    case "buy-gear":
      await controller.buyGear();
      return { applied: true, call: "buyGear" };

    case "upgrade-hull":
      await controller.upgradeHull();
      return { applied: true, call: "upgradeHull" };

    case "buy-module":
      await controller.buyModule();
      return { applied: true, call: "buyModule" };

    case "take-loan":
      await controller.takeLoan();
      return { applied: true, call: "takeLoan" };

    case "repay-loan":
      await controller.repayLoan();
      return { applied: true, call: "repayLoan" };

    case "sell-cargo":
      await controller.sellCargo();
      return { applied: true, call: "sellCargo" };

    case "arm-up":
      await controller.armUp();
      return { applied: true, call: "armUp" };

    case "liberate":
      await controller.liberate();
      return { applied: true, call: "liberate" };

    default:
      return skipped(`unhandled: ${(action as Action).kind}`);
  }
}
