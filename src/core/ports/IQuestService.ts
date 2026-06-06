import type { Quest, QuestFailurePenalty } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import type { QuestType, QuestObjective, Reward } from "@/types";

/**
 * Quest template for creating new quests
 */
export interface QuestTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly type: QuestType;
  readonly objectives: Omit<QuestObjective, "completed" | "currentAmount">[];
  readonly reward: Reward;
  readonly dialogueAnchors: {
    readonly nodeId: string;
    readonly text: string;
  }[];
  readonly deadline: number; // Days to complete (0 = no deadline)
  readonly failurePenalty: QuestFailurePenalty | null; // Penalty on failure/expiration
  readonly targetSystemId?: string | null;
  readonly targetObjectId?: string | null;
}

/**
 * Event payload for quest progress updates.
 */
export interface QuestProgressEvent {
  readonly type: "COLLECT_ITEM" | "VISIT_LOCATION" | "DEFEAT_ENEMY";
  readonly itemType?: string;
  readonly locationId?: string;
  readonly amount?: number;
}

/**
 * Port for quest lifecycle management.
 * Follows SRP: quest logic separate from GameEngine.
 */
export interface IQuestService {
  acceptQuest(
    templateId: string,
    planetId?: string,
    currentDay?: number,
  ): Quest | null;
  /**
   * Accept a quest from an externally-built template (e.g. the quest generator's
   * job board, EPIC-008). The template is registered, then accepted.
   */
  acceptQuestFromTemplate(
    template: QuestTemplate,
    planetId?: string,
    currentDay?: number,
  ): Quest | null;
  updateQuestProgress(event: QuestProgressEvent): void;
  completeQuest(questId: string, player: Player): boolean;
  getActiveQuests(): Quest[];
  getCompletedQuestIds(): string[];
  getQuestTemplate(templateId: string): QuestTemplate | undefined;
  canCompleteQuest(questId: string): boolean;
  getActiveQuestLocations(): string[];
  checkExpiredQuests(currentDay: number, player: Player): void;
  getUrgentQuests(currentDay: number): Quest[];
  /** Restore quest state from a loaded save (active quests + completed ids). */
  restoreState(activeQuests: Quest[], completedQuestIds: string[]): void;
  /**
   * Force-complete a quest regardless of objective state and grant reward.
   * Used by auto-completion triggers (planet landing, system entry, NPC kill).
   */
  forceCompleteQuest(questId: string, player: Player): boolean;
}
