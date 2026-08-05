import { QuestType } from "@/types";
import type { QuestObjective, ResourceType } from "@/types";

export interface ResourceStackLike {
  type: string;
  amount: number;
}

export interface DeliveryPlayerLike {
  inventory: { resources: ResourceStackLike[] };
}

export interface DeliveryQuestLike {
  type: QuestType;
  isCompleted: boolean;
  isFailed: boolean;
  targetSystemId: string | null;
  targetPlanetId?: string | null;
  objectives: QuestObjective[];
}

export type DeliveryEvaluation =
  | { kind: "complete"; collectObj?: QuestObjective; stack?: ResourceStackLike }
  | {
      kind: "shortfall";
      cargo: ResourceType;
      required: number;
      carried: number;
    }
  | { kind: "n/a" };

export function evaluateDelivery(
  quest: DeliveryQuestLike,
  player: DeliveryPlayerLike,
  currentSystemId: string,
  currentPlanetId?: string | null,
): DeliveryEvaluation {
  if (quest.type !== QuestType.DELIVERY) return { kind: "n/a" };
  if (quest.isCompleted || quest.isFailed) return { kind: "n/a" };
  if (quest.targetSystemId !== currentSystemId) return { kind: "n/a" };
  const isCourier = !quest.objectives.some((o) => o.type === "VISIT_LOCATION");
  if (
    isCourier &&
    quest.targetPlanetId != null &&
    currentPlanetId != null &&
    currentPlanetId !== quest.targetPlanetId
  ) {
    return { kind: "n/a" };
  }

  const collectObj = quest.objectives.find(
    (o) => o.type === "COLLECT_ITEM" && !o.completed,
  );
  if (!collectObj || !collectObj.itemType) {
    return { kind: "complete", collectObj };
  }

  const stack = player.inventory.resources.find(
    (r) => r.type === collectObj.itemType,
  );
  const carried = stack?.amount ?? 0;
  if (carried < collectObj.targetAmount) {
    return {
      kind: "shortfall",
      cargo: collectObj.itemType,
      required: collectObj.targetAmount,
      carried,
    };
  }
  return { kind: "complete", collectObj, stack };
}
