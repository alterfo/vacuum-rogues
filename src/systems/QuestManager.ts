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
  targetPlanetId?: string | null;
  minReputation?: number;
  minRank?: number;
  chainId?: string | null;
  chainPart?: number;
}

export class QuestManager {
  private activeQuests: Map<string, Quest> = new Map();
  private completedQuests: Set<string> = new Set();
  private failedQuests: Map<string, Quest> = new Map();
  private pendingReturnQuests: Map<string, Quest> = new Map();
  private questTemplates: Map<string, QuestTemplate> = new Map();
  private completedChainParts: Map<string, Set<number>> = new Map();
  private bank: BankAccess | null = null;

  constructor() {}

  attachBank(access: BankAccess | null): void {
    this.bank = access;
  }

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

    if (
      this.activeQuests.has(template.id) ||
      this.pendingReturnQuests.has(template.id)
    ) {
      logger.warn(`Quest already active: ${template.id}`);
      return null;
    }

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

  acceptQuestFromTemplate(
    template: QuestTemplate,
    planetId: string = "unknown",
    currentDay: number = 0,
    factionId: string = "",
  ): Quest | null {
    this.questTemplates.set(template.id, template);
    const quest = this.acceptQuest(
      template.id,
      planetId,
      currentDay,
      factionId,
    );
    return quest;
  }

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

  private grantReward(quest: Quest, player: Player): void {
    adjustPlayerCredits(
      this.bank,
      player,
      quest.reward.credits,
      GL_COUNTERPARTY.REWARDS,
      `Награда: ${quest.title}`,
    );
    player.experience += quest.reward.experience;

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

    if (quest.chainId && quest.chainPart >= 0) {
      const parts =
        this.completedChainParts.get(quest.chainId) ?? new Set<number>();
      parts.add(quest.chainPart);
      this.completedChainParts.set(quest.chainId, parts);
      if (parts.has(0) && parts.has(1) && parts.has(2)) {
        if (!player.completedQuestChains.includes(quest.chainId)) {
          player.completedQuestChains.push(quest.chainId);
          logger.info(`Quest chain completed: ${quest.chainId}`);
        }
      }
    }
  }

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

  completeQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || !quest.isCompleted) {
      return false;
    }

    this.grantReward(quest, player);

    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);

    logger.info(
      `Quest completed: ${quest.title} - Rewards: ${quest.reward.credits} credits, ${quest.reward.experience} XP`,
    );

    return true;
  }

  getActiveQuests(): Quest[] {
    return Array.from(this.activeQuests.values());
  }

  getCompletedQuestIds(): string[] {
    return Array.from(this.completedQuests);
  }

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

  getCompletedChainParts(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [chainId, parts] of this.completedChainParts) {
      out[chainId] = Array.from(parts).sort((a, b) => a - b);
    }
    return out;
  }

  getQuestTemplate(templateId: string): QuestTemplate | undefined {
    return this.questTemplates.get(templateId);
  }

  canCompleteQuest(questId: string): boolean {
    const quest = this.activeQuests.get(questId);
    return quest?.isCompleted ?? false;
  }

  getActiveQuestLocations(): string[] {
    const locations: string[] = [];

    for (const quest of this.activeQuests.values()) {
      if (quest.isCompleted) continue;

      for (const objective of quest.objectives) {
        if (objective.completed) continue;

        if (objective.type === "VISIT_LOCATION" && objective.locationId) {
          if (objective.locationId !== "any_planet") {
            locations.push(objective.locationId);
          }
        }
      }
    }

    return locations;
  }

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

  getExpiredQuests(): Quest[] {
    return Array.from(this.failedQuests.values());
  }

  private failQuest(quest: Quest, player: Player): void {
    quest.markAsFailed();
    this.failedQuests.set(quest.id, quest);

    if (quest.failurePenalty) {
      this.applyFailurePenalty(quest, player);
    }

    this.activeQuests.delete(quest.id);

    logger.warn(
      `Quest failed: ${quest.title} - ${quest.failurePenalty?.description ?? "No penalties"}`,
    );
  }

  private applyFailurePenalty(quest: Quest, player: Player): void {
    if (!quest.failurePenalty) return;

    const penalty = quest.failurePenalty;

    if (penalty.reputationLoss > 0) {
      const repKey = quest.factionId || quest.planetId;
      player.adjustReputation(repKey, -penalty.reputationLoss);
      logger.info(
        `Reputation loss: -${penalty.reputationLoss} on ${repKey} (now ${player.getReputation(repKey)})`,
      );
    }

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

    if (penalty.jailTime && penalty.jailTime > 0) {
      logger.warn(
        `Player sentenced to ${penalty.jailTime} days in jail (not implemented in MVP)`,
      );
    }
  }

  markObjectivesDone(questId: string): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || quest.isFailed) return false;
    this.completeAllObjectives(quest);
    quest.isCompleted = false;
    quest.isPendingReturn = true;
    this.activeQuests.delete(questId);
    this.pendingReturnQuests.set(questId, quest);
    logger.info(`Quest pending return (objectives done): ${quest.title}`);
    return true;
  }

  getPendingReturnQuests(): Quest[] {
    return Array.from(this.pendingReturnQuests.values());
  }

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

  forceCompleteQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || quest.isFailed) return false;
    if (!quest.isCompleted) {
      this.completeAllObjectives(quest);
    }
    return this.completeQuest(questId, player);
  }

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
