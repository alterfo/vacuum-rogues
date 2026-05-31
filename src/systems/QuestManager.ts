import { Quest } from '@/domain/Quest';
import type { Player } from '@/domain/Player';
import type { QuestType, QuestObjective, Reward } from '@/types';
import { ResourceType } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Quest template for creating new quests
 */
export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  objectives: Omit<QuestObjective, 'completed' | 'currentAmount'>[];
  reward: Reward;
  dialogueAnchors: { nodeId: string; text: string }[];
}

/**
 * Manages quest lifecycle: acceptance, tracking, completion, rewards
 */
export class QuestManager {
  private activeQuests: Map<string, Quest> = new Map();
  private completedQuests: Set<string> = new Set();
  private questTemplates: Map<string, QuestTemplate> = new Map();

  constructor() {
    this.loadQuestTemplates();
  }

  /**
   * Load quest templates (hardcoded for MVP)
   */
  private loadQuestTemplates(): void {
    // Delivery quest template
    this.questTemplates.set('quest_delivery_ore', {
      id: 'quest_delivery_ore',
      title: 'Доставка руды',
      description: 'Доставить 10 единиц руды на станцию Омега',
      type: 'DELIVERY' as QuestType,
      objectives: [
        {
          id: 'obj_collect_ore',
          description: 'Собрать руду',
          type: 'COLLECT_ITEM',
          targetAmount: 10,
          itemType: ResourceType.METALS,
        },
        {
          id: 'obj_deliver_ore',
          description: 'Доставить на станцию Омега',
          type: 'VISIT_LOCATION',
          targetAmount: 1,
          locationId: 'planet_omega_station',
        },
      ],
      reward: {
        credits: 100,
        experience: 50,
        items: [],
      },
      dialogueAnchors: [
        { nodeId: 'quest_offer', text: 'Нам нужна руда для строительства.' },
        { nodeId: 'quest_complete', text: 'Отличная работа, рейнджер!' },
      ],
    });

    // Exploration quest
    this.questTemplates.set('quest_explore_system', {
      id: 'quest_explore_system',
      title: 'Исследование системы',
      description: 'Посетить 3 неизвестные планеты',
      type: 'EXPLORATION' as QuestType,
      objectives: [
        {
          id: 'obj_visit_planets',
          description: 'Посетить планеты',
          type: 'VISIT_LOCATION',
          targetAmount: 3,
          locationId: 'any_planet',
        },
      ],
      reward: {
        credits: 200,
        experience: 100,
        items: [],
      },
      dialogueAnchors: [
        { nodeId: 'quest_offer', text: 'Нам нужна информация о соседних планетах.' },
        { nodeId: 'quest_complete', text: 'Ценные данные! Спасибо.' },
      ],
    });

    logger.info(`Loaded ${this.questTemplates.size} quest templates`);
  }

  /**
   * Create and accept a new quest from template
   */
  acceptQuest(templateId: string): Quest | null {
    const template = this.questTemplates.get(templateId);
    if (!template) {
      logger.warn(`Quest template not found: ${templateId}`);
      return null;
    }

    // Check if already active
    if (this.activeQuests.has(template.id)) {
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
    );

    this.activeQuests.set(quest.id, quest);
    logger.info(`Quest accepted: ${quest.title}`);

    return quest;
  }

  /**
   * Update quest progress based on player action
   */
  updateQuestProgress(event: {
    type: 'COLLECT_ITEM' | 'VISIT_LOCATION' | 'DEFEAT_ENEMY';
    itemType?: string;
    locationId?: string;
    amount?: number;
  }): void {
    for (const quest of this.activeQuests.values()) {
      if (quest.isCompleted) continue;

      for (const objective of quest.objectives) {
        if (objective.completed) continue;

        // Check if event matches objective
        let matches = false;
        if (event.type === 'COLLECT_ITEM' && objective.type === 'COLLECT_ITEM') {
          matches = objective.itemType === event.itemType;
        } else if (event.type === 'VISIT_LOCATION' && objective.type === 'VISIT_LOCATION') {
          matches =
            objective.locationId === event.locationId || objective.locationId === 'any_planet';
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
   * Complete a quest and distribute rewards
   */
  completeQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || !quest.isCompleted) {
      return false;
    }

    // Distribute rewards
    player.credits += quest.reward.credits;
    player.experience += quest.reward.experience;

    // Add reward items to inventory
    for (const item of quest.reward.items) {
      const existing = player.inventory.resources.find((r) => r.type === item.type);
      if (existing) {
        existing.amount += item.amount;
      } else {
        player.inventory.resources.push({ type: item.type, amount: item.amount });
      }
    }

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
}
