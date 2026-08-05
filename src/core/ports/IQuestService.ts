import type { Quest, QuestFailurePenalty } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import type { QuestType, QuestObjective, Reward } from "@/types";
import type { BankAccess } from "@/systems/banking/economy";

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
  readonly targetPlanetId?: string | null;
}

export interface QuestProgressEvent {
  readonly type:
    | "COLLECT_ITEM"
    | "VISIT_LOCATION"
    | "VISIT_SYSTEM"
    | "DEFEAT_ENEMY";
  readonly itemType?: string;
  readonly locationId?: string;
  readonly systemId?: string;
  readonly amount?: number;
}

export interface IQuestService {
  acceptQuest(
    templateId: string,
    planetId?: string,
    currentDay?: number,
    factionId?: string,
  ): Quest | null;
  acceptQuestFromTemplate(
    template: QuestTemplate,
    planetId?: string,
    currentDay?: number,
    factionId?: string,
  ): Quest | null;
  updateQuestProgress(event: QuestProgressEvent): void;
  completeQuest(questId: string, player: Player): boolean;
  getActiveQuests(): Quest[];
  getCompletedQuestIds(): string[];
  getQuestTemplate(templateId: string): QuestTemplate | undefined;
  canCompleteQuest(questId: string): boolean;
  getActiveQuestLocations(): string[];
  checkExpiredQuests(currentDay: number, player: Player): Quest[];
  getUrgentQuests(currentDay: number): Quest[];
  getExpiredQuests?(): Quest[];
  restoreState(
    activeQuests: Quest[],
    completedQuestIds: string[],
    completedChainParts?: Record<string, number[]>,
    pendingReturnQuests?: Quest[],
  ): void;
  getCompletedChainParts(): Record<string, number[]>;
  forceCompleteQuest(questId: string, player: Player): boolean;
  markObjectivesDone(questId: string): boolean;
  getPendingReturnQuests(): Quest[];
  claimReturnReward(questId: string, player: Player): boolean;
  attachBank?(access: BankAccess | null): void;
}
