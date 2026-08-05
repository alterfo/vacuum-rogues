import type { GameEngine } from "@/systems/GameEngine";
import { QuestType } from "@/types";
import { logger } from "@/utils/logger";

export class QuestCompletion {
  constructor(private readonly gameEngine: GameEngine | null) {}

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

  escortBySystemEntry(): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.ESCORT) continue;
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
          galaxy.tryLiberate(quest.targetObjectId, "player");
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
