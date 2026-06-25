import type { Quest, QuestFailurePenalty } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import type { QuestType, QuestObjective, Reward } from "@/types";
import type { BankAccess } from "@/systems/banking/economy";

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
  /** Specific target planet (e.g. the local-delivery neighbour); null = system-level. */
  readonly targetPlanetId?: string | null;
}

/**
 * Event payload for quest progress updates.
 */
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

/**
 * Port for quest lifecycle management.
 * Follows SRP: quest logic separate from GameEngine.
 */
export interface IQuestService {
  acceptQuest(
    templateId: string,
    planetId?: string,
    currentDay?: number,
    factionId?: string,
  ): Quest | null;
  /**
   * Accept a quest from an externally-built template (e.g. the quest generator's
   * job board, EPIC-008). The template is registered, then accepted.
   */
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
  /** Failed/expired quests kept in memory for the journal's "Провалено" section. */
  getExpiredQuests?(): Quest[];
  /** Restore quest state from a loaded save (active quests + completed ids + chain parts + pending return). */
  restoreState(
    activeQuests: Quest[],
    completedQuestIds: string[],
    completedChainParts?: Record<string, number[]>,
    pendingReturnQuests?: Quest[],
  ): void;
  /** Serialize completedChainParts for persistence. */
  getCompletedChainParts(): Record<string, number[]>;
  /**
   * Force-complete a quest regardless of objective state and grant reward.
   * Used by auto-completion triggers (planet landing, system entry, NPC kill).
   */
  forceCompleteQuest(questId: string, player: Player): boolean;
  /**
   * Mark all objectives done without granting reward. Moves quest to
   * pending-return state. Player must return to issuer planet to claim reward.
   */
  markObjectivesDone(questId: string): boolean;
  /** Return all quests waiting for return-to-issuer reward claim. */
  getPendingReturnQuests(): Quest[];
  /** Claim reward for a pending-return quest on landing at the issuer planet. */
  claimReturnReward(questId: string, player: Player): boolean;
  /**
   * Hand the quest system the bank so reward/fine credit moves book a balanced
   * ledger entry via the bus instead of poking `player.credits`. Optional —
   * unit-test doubles that never wire the bank simply don't implement it.
   */
  attachBank?(access: BankAccess | null): void;
}
