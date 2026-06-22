import { QuestType } from "@/types";
import type { QuestObjective, ResourceType } from "@/types";

/**
 * Pure, Pixi/DOM-free decision helper for the on-landing DELIVERY completion
 * check. It is the single source of truth for "can this delivery complete in the
 * current system, and if not, why" — the scene only renders the result.
 *
 * Extracted from `PlanetScene.checkDeliveryQuestCompletion` so a player who
 * bought too little cargo gets explicit feedback (a `shortfall`) instead of a
 * silent no-op.
 */

/** Minimal structural view of a resource stack carried by the player. */
export interface ResourceStackLike {
  type: string;
  amount: number;
}

/** Minimal structural view of the player needed to evaluate a delivery. */
export interface DeliveryPlayerLike {
  inventory: { resources: ResourceStackLike[] };
}

/** Minimal structural view of the quest needed to evaluate a delivery. */
export interface DeliveryQuestLike {
  type: QuestType;
  isCompleted: boolean;
  isFailed: boolean;
  targetSystemId: string | null;
  objectives: QuestObjective[];
}

/**
 * Discriminated outcome of evaluating a delivery quest on landing:
 * - `complete`  — the quest can be force-completed here. `collectObj`/`stack`
 *   are provided when there is a cargo requirement to deduct (absent for a
 *   delivery with no COLLECT_ITEM objective, which completes unconditionally).
 * - `shortfall` — the quest targets this system but the player is short on the
 *   required cargo. Carries the cargo + carried/required counts for the toast.
 * - `n/a`       — not a relevant delivery here (wrong type, already finished, or
 *   targeting a different system); the scene should ignore it silently.
 */
export type DeliveryEvaluation =
  | { kind: "complete"; collectObj?: QuestObjective; stack?: ResourceStackLike }
  | {
      kind: "shortfall";
      cargo: ResourceType;
      required: number;
      carried: number;
    }
  | { kind: "n/a" };

/**
 * Decide whether `quest` can be completed on landing in `currentSystemId`.
 * Pure: reads only the quest objectives and the player's carried resources.
 */
export function evaluateDelivery(
  quest: DeliveryQuestLike,
  player: DeliveryPlayerLike,
  currentSystemId: string,
): DeliveryEvaluation {
  if (quest.type !== QuestType.DELIVERY) return { kind: "n/a" };
  if (quest.isCompleted || quest.isFailed) return { kind: "n/a" };
  if (quest.targetSystemId !== currentSystemId) return { kind: "n/a" };

  const collectObj = quest.objectives.find(
    (o) => o.type === "COLLECT_ITEM" && !o.completed,
  );
  // No cargo requirement → delivery completes purely on arrival.
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
