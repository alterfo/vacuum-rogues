import type { IQuestService } from "@/core/ports";
import type { Player } from "@/domain/Player";
import { logger } from "@/utils/logger";

export class QuestDirector {
  private onQuestExpired: ((questId: string) => void) | null = null;

  setOnQuestExpired(handler: (questId: string) => void): void {
    this.onQuestExpired = handler;
  }

  tick(day: number, questManager: IQuestService, player: Player): string[] {
    const before = questManager.getActiveQuests().map((q) => q.id);
    questManager.checkExpiredQuests(day, player);
    const after = new Set(questManager.getActiveQuests().map((q) => q.id));

    const expiredIds = before.filter((id) => !after.has(id));
    for (const id of expiredIds) {
      logger.info(`QuestDirector: quest expired — ${id}`);
      this.onQuestExpired?.(id);
    }
    return expiredIds;
  }
}
