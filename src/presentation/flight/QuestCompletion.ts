import type { GameEngine } from "@/systems/GameEngine";
import { QuestType } from "@/types";
import { logger } from "@/utils/logger";

/**
 * Auto-completes the quests that resolve as a side-effect of flying into a
 * system or killing an NPC — exploration/defense on system entry, bounties on a
 * confirmed kill. Extracted from SpaceFlightScene: these are domain rules driven
 * by flight events, not part of the scene's render/input loop (SRP). The scene
 * fires the matching method at the relevant moment in initialize().
 */
export class QuestCompletion {
  constructor(private readonly gameEngine: GameEngine | null) {}

  /** Mark BOUNTY quests targeting the defeated NpcShip as pending-return. */
  bountyByNpcKill(npcId: string): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.BOUNTY) continue;
      if (quest.isCompleted || quest.isFailed || quest.isPendingReturn)
        continue;
      const matchesNpc = quest.targetObjectId === npcId;
      // If the bound bounty target was killed off-screen (another NPC got it
      // first, so it's gone from the galaxy), fall back to system matching so
      // any pirate kill in the target system still completes the quest.
      const bountyTargetGone =
        !!quest.targetObjectId &&
        !this.gameEngine.galaxy?.npcShips?.some(
          (n) => n.id === quest.targetObjectId,
        );
      const matchesSystem =
        (!quest.targetObjectId || bountyTargetGone) &&
        quest.targetSystemId === currentSystemId;
      if (!matchesNpc && !matchesSystem) continue;
      const marked = questManager.markObjectivesDone(quest.id);
      if (marked) {
        logger.info(
          `BOUNTY quest objectives done, pending return: ${quest.title} (npcId=${npcId})`,
        );
        this.gameEngine.questPendingReturnCallback?.(
          `Цель уничтожена! Вернитесь за наградой`,
        );
      }
    }
  }

  /** Mark EXPLORATION quests targeting the current system as pending-return. */
  explorationBySystemEntry(): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.EXPLORATION) continue;
      if (quest.isCompleted || quest.isFailed || quest.isPendingReturn)
        continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const marked = questManager.markObjectivesDone(quest.id);
      if (marked) {
        logger.info(
          `EXPLORATION quest objectives done, pending return: ${quest.title}`,
        );
        this.gameEngine.questPendingReturnCallback?.(
          `Система исследована! Вернитесь за наградой`,
        );
      }
    }
  }

  /** Mark ESCORT quests whose convoy reaches the target system as pending-return. */
  escortBySystemEntry(): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.ESCORT) continue;
      // NOTE: isCompleted is intentionally NOT skipped here. Escort quests use a
      // VISIT_SYSTEM objective; arriving fires the matching quest-progress event
      // which pre-sets isCompleted=true. Such a quest is still sitting in
      // activeQuests (the return gate has not run yet) and must be routed to
      // pending-return, otherwise its reward is never claimable. A genuinely
      // finished escort has already left activeQuests, so this can't double-fire.
      if (quest.isFailed || quest.isPendingReturn) continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const marked = questManager.markObjectivesDone(quest.id);
      if (marked) {
        logger.info(
          `ESCORT quest objectives done, pending return: ${quest.title}`,
        );
        this.gameEngine.questPendingReturnCallback?.(
          `Конвой доставлен! Вернитесь за наградой`,
        );
      }
    }
  }

  /**
   * Mark DEFENSE quests targeting the current system as pending-return and
   * liberate the adjacent OVERMIND system stored on the quest.
   */
  defenseBySystemEntry(): void {
    if (!this.gameEngine?.player || !this.gameEngine.galaxy) return;
    const player = this.gameEngine.player;
    const galaxy = this.gameEngine.galaxy;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DEFENSE) continue;
      if (quest.isCompleted || quest.isFailed || quest.isPendingReturn)
        continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const marked = questManager.markObjectivesDone(quest.id);
      if (marked) {
        if (quest.targetObjectId) {
          galaxy.tryLiberate(quest.targetObjectId);
          logger.info(
            `DEFENSE quest objectives done: ${quest.title}, liberated hostile system ${quest.targetObjectId}`,
          );
        }
        this.gameEngine.questPendingReturnCallback?.(
          `Система обороняется! Вернитесь за наградой`,
        );
      }
    }
  }
}
