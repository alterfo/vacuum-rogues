import { Quest, QuestFailurePenalty } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import type { QuestType, QuestObjective, Reward } from "@/types";
import { logger } from "@/utils/logger";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import { QUEST_REPUTATION_REWARD } from "@/config/balance";

/**
 * Quest template for creating new quests
 */
export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  objectives: Omit<QuestObjective, "completed" | "currentAmount">[];
  reward: Reward;
  dialogueAnchors: { nodeId: string; text: string }[];
  deadline: number; // Days to complete (0 = no deadline)
  failurePenalty: QuestFailurePenalty | null; // Penalty on failure/expiration
  targetSystemId?: string | null;
  targetObjectId?: string | null;
  /** Specific target planet (e.g. the local-delivery neighbour); null = system-level. */
  targetPlanetId?: string | null;
  /** Minimum faction reputation required to see this quest (0 = no restriction). */
  minReputation?: number;
  /** Minimum player rank required to see this quest (0 = no restriction). */
  minRank?: number;
  /** Chain identifier shared by 3 sequential chain-quest parts (null = standalone). */
  chainId?: string | null;
  /** Position in the chain: 0/1/2 for parts, 3 for finale, -1 = not a chain quest. */
  chainPart?: number;
}

/**
 * Manages quest lifecycle: acceptance, tracking, completion, rewards
 */
export class QuestManager {
  private activeQuests: Map<string, Quest> = new Map();
  private completedQuests: Set<string> = new Set();
  /** Failed/expired quests kept in memory for the journal's "Провалено" section. */
  private failedQuests: Map<string, Quest> = new Map();
  /** Quests whose objectives are done but reward not yet claimed (player must return to issuer). */
  private pendingReturnQuests: Map<string, Quest> = new Map();
  private questTemplates: Map<string, QuestTemplate> = new Map();
  /** In-memory tracking of completed chain parts; persisted in player.questLog on save/load. */
  private completedChainParts: Map<string, Set<number>> = new Map();
  /** Bank for routing reward/fine credit moves through the bus (null until wired). */
  private bank: BankAccess | null = null;

  constructor() {}

  /** Wire the bank so reward/fine moves book a balanced ledger entry via the bus. */
  attachBank(access: BankAccess | null): void {
    this.bank = access;
  }

  /**
   * Create and accept a new quest from template
   * @param templateId Quest template ID
   * @param planetId Planet where quest is issued (for reputation tracking)
   * @param currentDay Current game day (for deadline tracking)
   * @param factionId Faction that controls the issuing planet (for faction reputation penalty on failure)
   */
  acceptQuest(
    templateId: string,
    planetId: string = "unknown",
    currentDay: number = 0,
    factionId: string = "",
  ): Quest | null {
    const template = this.questTemplates.get(templateId);
    if (!template) {
      logger.warn(`Quest template not found: ${templateId}`);
      return null;
    }

    // Check if already active, or awaiting reward claim (pending return).
    // Without the pending-return guard the same quest can be re-accepted from
    // the board while a copy still sits in pendingReturnQuests, duplicating the
    // id across two collections and allowing the reward to be farmed.
    if (
      this.activeQuests.has(template.id) ||
      this.pendingReturnQuests.has(template.id)
    ) {
      logger.warn(`Quest already active: ${template.id}`);
      return null;
    }

    // Create quest with initialized objectives
    const objectives: QuestObjective[] = template.objectives.map((obj) => ({
      ...obj,
      currentAmount: 0,
      completed: false,
    }));

    const quest = new Quest(
      template.id,
      template.title,
      template.type,
      objectives,
      template.reward,
      [], // dialogueAnchors not used in MVP, will be integrated later
      planetId,
      currentDay,
      template.deadline,
      template.failurePenalty,
      template.targetSystemId ?? null,
      template.targetObjectId ?? null,
      template.minReputation ?? 0,
      template.chainId ?? null,
      template.chainPart ?? -1,
      factionId,
      template.targetPlanetId ?? null,
    );

    this.activeQuests.set(quest.id, quest);
    logger.info(
      `Quest accepted: ${quest.title} (Deadline: ${template.deadline === 0 ? "none" : `${template.deadline} days`})`,
    );

    return quest;
  }

  /**
   * Accept a quest from an externally-built template — e.g. one produced by the
   * {@link QuestGenerator} job board (EPIC-008). The template is registered so
   * {@link getQuestTemplate} keeps working, then accepted like any other.
   */
  acceptQuestFromTemplate(
    template: QuestTemplate,
    planetId: string = "unknown",
    currentDay: number = 0,
    factionId: string = "",
  ): Quest | null {
    this.questTemplates.set(template.id, template);
    // Ensure new fields from the template are preserved when the quest is
    // constructed via acceptQuest → new Quest(...). We inject them after creation.
    const quest = this.acceptQuest(
      template.id,
      planetId,
      currentDay,
      factionId,
    );
    return quest;
  }

  /**
   * Update quest progress based on player action
   */
  updateQuestProgress(event: {
    type: "COLLECT_ITEM" | "VISIT_LOCATION" | "VISIT_SYSTEM" | "DEFEAT_ENEMY";
    itemType?: string;
    locationId?: string;
    systemId?: string;
    amount?: number;
  }): void {
    for (const quest of this.activeQuests.values()) {
      if (quest.isCompleted) continue;

      for (const objective of quest.objectives) {
        if (objective.completed) continue;

        // Check if event matches objective
        let matches = false;
        if (
          event.type === "COLLECT_ITEM" &&
          objective.type === "COLLECT_ITEM"
        ) {
          matches = objective.itemType === event.itemType;
        } else if (
          event.type === "VISIT_LOCATION" &&
          objective.type === "VISIT_LOCATION"
        ) {
          matches =
            objective.locationId === event.locationId ||
            objective.locationId === "any_planet";
        } else if (
          event.type === "VISIT_SYSTEM" &&
          objective.type === "VISIT_SYSTEM"
        ) {
          matches = objective.targetSystemId === event.systemId;
        }

        if (matches) {
          quest.updateProgress({
            objectiveId: objective.id,
            amount: event.amount ?? 1,
          });

          logger.debug(
            `Quest progress: ${quest.title} - ${objective.description}: ${objective.currentAmount}/${objective.targetAmount}`,
          );
        }
      }
    }
  }

  /**
   * Grant a quest's reward (credits, XP, items) to the player and record chain
   * progress. Shared by {@link completeQuest} and {@link claimReturnReward} so
   * the two reward-grant paths can never silently diverge.
   */
  private grantReward(quest: Quest, player: Player): void {
    adjustPlayerCredits(
      this.bank,
      player,
      quest.reward.credits,
      GL_COUNTERPARTY.REWARDS,
      `Награда: ${quest.title}`,
    );
    player.experience += quest.reward.experience;

    // Faction reputation recovery loop (Task 2): success raises standing with
    // the SAME faction key the expiry penalty subtracts from (factionId, falling
    // back to planetId — see applyFailurePenalty), so honest play visibly climbs
    // out of a decayed −50. Modest + clamped in adjustReputation, so it takes
    // several quests to recover and never overshoots.
    const repKey = quest.factionId || quest.planetId;
    if (repKey) {
      player.adjustReputation(repKey, QUEST_REPUTATION_REWARD);
      logger.info(
        `Reputation reward: +${QUEST_REPUTATION_REWARD} on ${repKey} (now ${player.getReputation(repKey)})`,
      );
    }

    for (const item of quest.reward.items) {
      const existing = player.inventory.resources.find(
        (r) => r.type === item.type,
      );
      if (existing) {
        existing.amount += item.amount;
      } else {
        player.inventory.resources.push({
          type: item.type,
          amount: item.amount,
        });
      }
    }

    // Chain completion tracking: record which part just finished.
    if (quest.chainId && quest.chainPart >= 0) {
      const parts =
        this.completedChainParts.get(quest.chainId) ?? new Set<number>();
      parts.add(quest.chainPart);
      this.completedChainParts.set(quest.chainId, parts);
      // Chain has 3 regular parts (0, 1, 2). All done → mark chain complete on player.
      if (parts.has(0) && parts.has(1) && parts.has(2)) {
        if (!player.completedQuestChains.includes(quest.chainId)) {
          player.completedQuestChains.push(quest.chainId);
          logger.info(`Quest chain completed: ${quest.chainId}`);
        }
      }
    }
  }

  /**
   * Force every objective on a quest to its target amount. Shared by
   * {@link forceCompleteQuest} and {@link markObjectivesDone}.
   */
  private completeAllObjectives(quest: Quest): void {
    for (const obj of quest.objectives) {
      if (!obj.completed) {
        quest.updateProgress({
          objectiveId: obj.id,
          amount: obj.targetAmount - obj.currentAmount,
        });
      }
    }
  }

  /**
   * Complete a quest and distribute rewards
   */
  completeQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || !quest.isCompleted) {
      return false;
    }

    this.grantReward(quest, player);

    // Remove from active and add to completed
    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);

    logger.info(
      `Quest completed: ${quest.title} - Rewards: ${quest.reward.credits} credits, ${quest.reward.experience} XP`,
    );

    return true;
  }

  /**
   * Get all active quests
   */
  getActiveQuests(): Quest[] {
    return Array.from(this.activeQuests.values());
  }

  /**
   * Get completed quest IDs
   */
  getCompletedQuestIds(): string[] {
    return Array.from(this.completedQuests);
  }

  /**
   * Restore quest state from a loaded save. Active quests come back as plain
   * JSON, so re-attach the Quest prototype to restore its methods
   * (isExpired, updateProgress, ...).
   */
  restoreState(
    activeQuests: Quest[],
    completedQuestIds: string[],
    completedChainParts: Record<string, number[]> = {},
    pendingReturnQuests: Quest[] = [],
  ): void {
    this.activeQuests.clear();
    for (const quest of activeQuests) {
      Object.setPrototypeOf(quest, Quest.prototype);
      this.activeQuests.set(quest.id, quest);
    }
    this.completedQuests = new Set(completedQuestIds);
    this.completedChainParts.clear();
    for (const [chainId, parts] of Object.entries(completedChainParts)) {
      this.completedChainParts.set(chainId, new Set(parts));
    }
    this.pendingReturnQuests.clear();
    for (const quest of pendingReturnQuests) {
      Object.setPrototypeOf(quest, Quest.prototype);
      this.pendingReturnQuests.set(quest.id, quest);
    }
  }

  /** Serialize completedChainParts for persistence. */
  getCompletedChainParts(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [chainId, parts] of this.completedChainParts) {
      out[chainId] = Array.from(parts).sort((a, b) => a - b);
    }
    return out;
  }

  /**
   * Get quest template by ID
   */
  getQuestTemplate(templateId: string): QuestTemplate | undefined {
    return this.questTemplates.get(templateId);
  }

  /**
   * Check if quest can be completed (all objectives done)
   */
  canCompleteQuest(questId: string): boolean {
    const quest = this.activeQuests.get(questId);
    return quest?.isCompleted ?? false;
  }

  /**
   * Get active quest objective location IDs (for navigation markers)
   * Returns array of location IDs that need to be visited
   */
  getActiveQuestLocations(): string[] {
    const locations: string[] = [];

    for (const quest of this.activeQuests.values()) {
      if (quest.isCompleted) continue;

      for (const objective of quest.objectives) {
        if (objective.completed) continue;

        if (objective.type === "VISIT_LOCATION" && objective.locationId) {
          // Skip "any_planet" type objectives
          if (objective.locationId !== "any_planet") {
            locations.push(objective.locationId);
          }
        }
      }
    }

    return locations;
  }

  /**
   * Check for expired quests and apply failure penalties
   * Should be called on each game day simulation
   * @param currentDay Current game day
   * @param player Player to apply penalties to
   */
  checkExpiredQuests(currentDay: number, player: Player): Quest[] {
    const expiredQuests: Quest[] = [];

    for (const quest of this.activeQuests.values()) {
      if (quest.isExpired(currentDay)) {
        expiredQuests.push(quest);
      }
    }

    for (const quest of expiredQuests) {
      this.failQuest(quest, player);
    }

    return expiredQuests;
  }

  /** Return all quests that have failed/expired in this session (for the journal). */
  getExpiredQuests(): Quest[] {
    return Array.from(this.failedQuests.values());
  }

  /**
   * Fail a quest and apply penalties
   * @param quest Quest to fail
   * @param player Player to apply penalties to
   */
  private failQuest(quest: Quest, player: Player): void {
    quest.markAsFailed();
    this.failedQuests.set(quest.id, quest);

    // Apply failure penalty if exists
    if (quest.failurePenalty) {
      this.applyFailurePenalty(quest, player);
    }

    // Remove from active quests (keep in failed state for journal)
    this.activeQuests.delete(quest.id);

    logger.warn(
      `Quest failed: ${quest.title} - ${quest.failurePenalty?.description ?? "No penalties"}`,
    );
  }

  /**
   * Apply failure penalty to player
   */
  private applyFailurePenalty(quest: Quest, player: Player): void {
    if (!quest.failurePenalty) return;

    const penalty = quest.failurePenalty;

    // Apply reputation loss — key by factionId so the penalty is visible on the
    // quest board (which filters by faction rep). Fall back to planetId for
    // older saves and test stubs that don't set factionId.
    if (penalty.reputationLoss > 0) {
      const repKey = quest.factionId || quest.planetId;
      player.adjustReputation(repKey, -penalty.reputationLoss);
      logger.info(
        `Reputation loss: -${penalty.reputationLoss} on ${repKey} (now ${player.getReputation(repKey)})`,
      );
    }

    // Apply credits fine — clamp the charge to the player's balance so credits
    // never go negative (the old behaviour), then book that exact magnitude.
    if (penalty.creditsFine && penalty.creditsFine > 0) {
      const applied = Math.min(penalty.creditsFine, player.credits);
      adjustPlayerCredits(
        this.bank,
        player,
        -applied,
        GL_COUNTERPARTY.FINES,
        `Штраф: ${quest.title}`,
      );
      logger.info(
        `Credits fine: -${penalty.creditsFine} credits (now ${player.credits})`,
      );
    }

    // Jail time is handled separately in scene logic (not implemented in MVP)
    if (penalty.jailTime && penalty.jailTime > 0) {
      logger.warn(
        `Player sentenced to ${penalty.jailTime} days in jail (not implemented in MVP)`,
      );
    }
  }

  /**
   * Mark all quest objectives done and move the quest to the pending-return
   * state — objectives are satisfied but reward is NOT granted yet. The player
   * must fly back to the issuer planet and call claimReturnReward there.
   * Used for BOUNTY/ESCORT/EXPLORATION/DEFENSE auto-triggers.
   */
  markObjectivesDone(questId: string): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || quest.isFailed) return false;
    this.completeAllObjectives(quest);
    // updateProgress sets isCompleted=true; override to pending-return state.
    quest.isCompleted = false;
    quest.isPendingReturn = true;
    this.activeQuests.delete(questId);
    this.pendingReturnQuests.set(questId, quest);
    logger.info(`Quest pending return (objectives done): ${quest.title}`);
    return true;
  }

  /** Return all quests awaiting return-to-issuer reward claim. */
  getPendingReturnQuests(): Quest[] {
    return Array.from(this.pendingReturnQuests.values());
  }

  /**
   * Claim the reward for a pending-return quest (player landed on issuer planet).
   * Grants rewards and moves quest to completed state.
   */
  claimReturnReward(questId: string, player: Player): boolean {
    const quest = this.pendingReturnQuests.get(questId);
    if (!quest) return false;

    this.grantReward(quest, player);

    quest.isCompleted = true;
    quest.isPendingReturn = false;
    this.pendingReturnQuests.delete(questId);
    this.completedQuests.add(questId);

    logger.info(
      `Return reward claimed: ${quest.title} +${quest.reward.credits} cr, +${quest.reward.experience} XP`,
    );
    return true;
  }

  /**
   * Force-complete a quest regardless of objective progress. Marks all
   * objectives done, then grants the reward. Used for auto-completion
   * triggers: DELIVERY on planet landing, EXPLORATION on system entry,
   * BOUNTY on NPC kill.
   */
  forceCompleteQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || quest.isFailed) return false;
    if (!quest.isCompleted) {
      this.completeAllObjectives(quest);
    }
    return this.completeQuest(questId, player);
  }

  /**
   * Get all quests with approaching deadlines (less than 3 days remaining)
   * @param currentDay Current game day
   */
  getUrgentQuests(currentDay: number): Quest[] {
    const urgentQuests: Quest[] = [];

    for (const quest of this.activeQuests.values()) {
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.deadline === 0) continue; // No deadline

      const remaining = quest.getRemainingDays(currentDay);
      if (remaining <= 3 && remaining > 0) {
        urgentQuests.push(quest);
      }
    }

    return urgentQuests;
  }
}
