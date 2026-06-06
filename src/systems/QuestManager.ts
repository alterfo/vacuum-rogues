import { Quest, QuestFailurePenalty } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import type { QuestType, QuestObjective, Reward } from "@/types";
import { ResourceType } from "@/types";
import { logger } from "@/utils/logger";

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
  /** Minimum faction reputation required to see this quest (0 = no restriction). */
  minReputation?: number;
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
  private questTemplates: Map<string, QuestTemplate> = new Map();
  /** In-memory tracking of completed chain parts; not persisted (lost on reload). */
  private completedChainParts: Map<string, Set<number>> = new Map();

  constructor() {
    this.loadQuestTemplates();
  }

  /**
   * Load quest templates (hardcoded for MVP)
   */
  private loadQuestTemplates(): void {
    // 1. Urgent medicine delivery - 3 days deadline, high reputation loss on failure
    this.questTemplates.set("quest_urgent_medicine", {
      id: "quest_urgent_medicine",
      title: "Срочная доставка вакцины",
      description: "Эпидемия на планете! Доставьте вакцину в течение 3 дней",
      type: "DELIVERY" as QuestType,
      objectives: [
        {
          id: "obj_collect_medicine",
          description: "Получить вакцину",
          type: "COLLECT_ITEM",
          targetAmount: 5,
          itemType: ResourceType.MEDICINE,
        },
        {
          id: "obj_deliver_medicine",
          description: "Доставить на зараженную планету",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 500,
        experience: 200,
        items: [],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "У нас эпидемия! Люди умирают каждый день!",
        },
        {
          nodeId: "quest_complete",
          text: "Вы спасли тысячи жизней, рейнджер!",
        },
      ],
      deadline: 3,
      failurePenalty: {
        reputationLoss: 50,
        description:
          "Сотни людей погибли из-за вашей медлительности. Вы навсегда останетесь врагом этого мира.",
      },
    });

    // 2. Bounty hunt - 5 days deadline, fine + reputation loss
    this.questTemplates.set("quest_bounty_hunt", {
      id: "quest_bounty_hunt",
      title: "Охота за преступником",
      description: "Найдите и уничтожьте пиратский корабль за 5 дней",
      type: "BOUNTY" as QuestType,
      objectives: [
        {
          id: "obj_defeat_pirate",
          description: "Уничтожить пиратский крейсер",
          type: "DEFEAT_ENEMY",
          targetAmount: 1,
          enemyType: "CRUISER" as any,
        },
      ],
      reward: {
        credits: 800,
        experience: 300,
        items: [{ type: ResourceType.WEAPONS, amount: 2 }],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "Этот пират терроризирует торговые пути уже месяц!",
        },
        {
          nodeId: "quest_complete",
          text: "Отличная работа! Космос стал безопаснее.",
        },
      ],
      deadline: 5,
      failurePenalty: {
        reputationLoss: 20,
        creditsFine: 200,
        description:
          "Пират сбежал и ограбил еще несколько кораблей. Вам придется заплатить компенсацию пострадавшим.",
      },
    });

    // 3. Research mission - 7 days deadline, small penalty
    this.questTemplates.set("quest_research_artifacts", {
      id: "quest_research_artifacts",
      title: "Научная экспедиция",
      description:
        "Соберите древние артефакты для исследовательского института",
      type: "EXPLORATION" as QuestType,
      objectives: [
        {
          id: "obj_collect_artifacts",
          description: "Собрать артефакты",
          type: "COLLECT_ITEM",
          targetAmount: 3,
          itemType: ResourceType.ARTIFACTS,
        },
      ],
      reward: {
        credits: 300,
        experience: 150,
        items: [],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "Нам нужны эти артефакты для важного открытия.",
        },
        {
          nodeId: "quest_complete",
          text: "Великолепно! Это поможет нашим исследованиям.",
        },
      ],
      deadline: 7,
      failurePenalty: {
        reputationLoss: 10,
        description:
          "Исследовательский грант истек. Институт разочарован вашей нерасторопностью.",
      },
    });

    // 4. Contraband delivery - 2 days deadline, JAIL TIME on failure!
    this.questTemplates.set("quest_contraband", {
      id: "quest_contraband",
      title: "Опасный груз",
      description:
        "Доставьте секретный груз за 2 дня. Не задавайте лишних вопросов.",
      type: "DELIVERY" as QuestType,
      objectives: [
        {
          id: "obj_deliver_contraband",
          description: "Доставить груз на указанную планету",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 1000,
        experience: 100,
        items: [],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "Груз... деликатный. Задержка недопустима.",
        },
        {
          nodeId: "quest_complete",
          text: "Вы знаете, как держать язык за зубами. Хорошо.",
        },
      ],
      deadline: 2,
      failurePenalty: {
        reputationLoss: 30,
        jailTime: 10,
        description:
          "Патруль перехватил просроченный груз. Незаконная контрабанда! Вас арестовали на 10 дней.",
      },
    });

    // 5. Diplomatic mission - 4 days deadline, severe consequences
    this.questTemplates.set("quest_diplomacy", {
      id: "quest_diplomacy",
      title: "Дипломатическая миссия",
      description:
        "Доставьте мирный договор между враждующими фракциями за 4 дня",
      type: "DIPLOMACY" as QuestType,
      objectives: [
        {
          id: "obj_deliver_treaty",
          description: "Доставить договор на планету переговоров",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 600,
        experience: 250,
        items: [{ type: ResourceType.LUXURY, amount: 3 }],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "Судьба миллионов зависит от этого договора!",
        },
        {
          nodeId: "quest_complete",
          text: "Мир восстановлен. Галактика в вашем долгу.",
        },
      ],
      deadline: 4,
      failurePenalty: {
        reputationLoss: 40,
        creditsFine: 500,
        description:
          "Переговоры сорвались. Война возобновилась. Обе стороны винят вас в катастрофе.",
      },
    });

    // 6. Rescue mission - 1 day deadline, CRITICAL reputation loss
    this.questTemplates.set("quest_rescue", {
      id: "quest_rescue",
      title: "Спасательная операция",
      description:
        "КРИТИЧНО: Корабль с колонистами терпит бедствие! Времени почти не осталось!",
      type: "ESCORT" as QuestType,
      objectives: [
        {
          id: "obj_reach_distress",
          description: "Добраться до координат бедствия",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 1500,
        experience: 400,
        items: [{ type: ResourceType.MEDICINE, amount: 5 }],
      },
      dialogueAnchors: [
        { nodeId: "quest_offer", text: "SOS! КИСЛОРОД НА ИСХОДЕ! ПОМОГИТЕ!" },
        {
          nodeId: "quest_complete",
          text: "*Рыдания благодарности* Вы спасли наши семьи...",
        },
      ],
      deadline: 1,
      failurePenalty: {
        reputationLoss: 80,
        description:
          "47 человек погибли. Среди них дети. Их крики будут преследовать вас вечно. Вы - убийца.",
      },
    });

    // 7. Simple delivery - NO deadline, relaxed quest
    this.questTemplates.set("quest_delivery_ore", {
      id: "quest_delivery_ore",
      title: "Доставка руды",
      description: "Доставьте руду на обитаемую планету. Спешки нет.",
      type: "DELIVERY" as QuestType,
      objectives: [
        {
          id: "obj_collect_ore",
          description: "Собрать руду",
          type: "COLLECT_ITEM",
          targetAmount: 10,
          itemType: ResourceType.METALS,
        },
        {
          id: "obj_deliver_ore",
          description: "Доставить на обитаемую планету",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 150,
        experience: 50,
        items: [],
      },
      dialogueAnchors: [
        { nodeId: "quest_offer", text: "Нам нужна руда для строительства." },
        { nodeId: "quest_complete", text: "Отличная работа, рейнджер!" },
      ],
      deadline: 0, // No deadline - relaxed quest
      failurePenalty: null, // No penalty
    });

    // 8. Exploration quest - 7 days, mild penalty
    this.questTemplates.set("quest_explore_system", {
      id: "quest_explore_system",
      title: "Картографирование системы",
      description: "Посетите 3 планеты и соберите данные для звездных карт",
      type: "EXPLORATION" as QuestType,
      objectives: [
        {
          id: "obj_visit_planets",
          description: "Посетить планеты",
          type: "VISIT_LOCATION",
          targetAmount: 3,
          locationId: "any_planet",
        },
      ],
      reward: {
        credits: 250,
        experience: 120,
        items: [{ type: ResourceType.DATA_CORES, amount: 2 }],
      },
      dialogueAnchors: [
        {
          nodeId: "quest_offer",
          text: "Нам нужны актуальные данные о системе.",
        },
        {
          nodeId: "quest_complete",
          text: "Отличные карты! Теперь навигация будет безопаснее.",
        },
      ],
      deadline: 7,
      failurePenalty: {
        reputationLoss: 15,
        description:
          "Картографическая гильдия недовольна задержкой. Устаревшие данные почти бесполезны.",
      },
    });

    logger.info(
      `Loaded ${this.questTemplates.size} quest templates (with time limits and penalties)`,
    );
  }

  /**
   * Create and accept a new quest from template
   * @param templateId Quest template ID
   * @param planetId Planet where quest is issued (for reputation tracking)
   * @param currentDay Current game day (for deadline tracking)
   */
  acceptQuest(
    templateId: string,
    planetId: string = "unknown",
    currentDay: number = 0,
  ): Quest | null {
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
      planetId,
      currentDay,
      template.deadline,
      template.failurePenalty,
      template.targetSystemId ?? null,
      template.targetObjectId ?? null,
      template.minReputation ?? 0,
      template.chainId ?? null,
      template.chainPart ?? -1,
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
  ): Quest | null {
    this.questTemplates.set(template.id, template);
    // Ensure new fields from the template are preserved when the quest is
    // constructed via acceptQuest → new Quest(...). We inject them after creation.
    const quest = this.acceptQuest(template.id, planetId, currentDay);
    return quest;
  }

  /**
   * Update quest progress based on player action
   */
  updateQuestProgress(event: {
    type: "COLLECT_ITEM" | "VISIT_LOCATION" | "DEFEAT_ENEMY";
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

    // Remove from active and add to completed
    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);

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
  restoreState(activeQuests: Quest[], completedQuestIds: string[]): void {
    this.activeQuests.clear();
    for (const quest of activeQuests) {
      Object.setPrototypeOf(quest, Quest.prototype);
      this.activeQuests.set(quest.id, quest);
    }
    this.completedQuests = new Set(completedQuestIds);
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
  checkExpiredQuests(currentDay: number, player: Player): void {
    const expiredQuests: Quest[] = [];

    for (const quest of this.activeQuests.values()) {
      if (quest.isExpired(currentDay)) {
        expiredQuests.push(quest);
      }
    }

    for (const quest of expiredQuests) {
      this.failQuest(quest, player);
    }
  }

  /**
   * Fail a quest and apply penalties
   * @param quest Quest to fail
   * @param player Player to apply penalties to
   */
  private failQuest(quest: Quest, player: Player): void {
    quest.markAsFailed();

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

    // Apply reputation loss
    if (penalty.reputationLoss > 0) {
      const currentRep = player.reputation[quest.planetId] ?? 0;
      (player.reputation as { [key: string]: number })[quest.planetId] =
        Math.max(-100, currentRep - penalty.reputationLoss);
      logger.info(
        `Reputation loss: -${penalty.reputationLoss} on planet ${quest.planetId} (now ${player.reputation[quest.planetId]})`,
      );
    }

    // Apply credits fine
    if (penalty.creditsFine && penalty.creditsFine > 0) {
      player.credits = Math.max(0, player.credits - penalty.creditsFine);
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
   * Force-complete a quest regardless of objective progress. Marks all
   * objectives done, then grants the reward. Used for auto-completion
   * triggers: DELIVERY on planet landing, EXPLORATION on system entry,
   * BOUNTY on NPC kill.
   */
  forceCompleteQuest(questId: string, player: Player): boolean {
    const quest = this.activeQuests.get(questId);
    if (!quest || quest.isFailed) return false;
    if (!quest.isCompleted) {
      for (const obj of quest.objectives) {
        if (!obj.completed) {
          quest.updateProgress({
            objectiveId: obj.id,
            amount: obj.targetAmount - obj.currentAmount,
          });
        }
      }
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
