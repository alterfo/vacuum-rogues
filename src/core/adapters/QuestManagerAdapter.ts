import type {
  IQuestService,
  QuestProgressEvent,
  QuestTemplate,
} from "@/core/ports/IQuestService";
import type { Quest } from "@/domain/Quest";
import type { Player } from "@/domain/Player";
import { QuestManager } from "@/systems/QuestManager";

/**
 * Adapter: makes QuestManager compatible with IQuestService port.
 */
export class QuestManagerAdapter implements IQuestService {
  private readonly delegate = new QuestManager();

  acceptQuest(
    templateId: string,
    planetId?: string,
    currentDay?: number,
    factionId?: string,
  ): Quest | null {
    return this.delegate.acceptQuest(
      templateId,
      planetId,
      currentDay,
      factionId,
    );
  }

  acceptQuestFromTemplate(
    template: QuestTemplate,
    planetId?: string,
    currentDay?: number,
    factionId?: string,
  ): Quest | null {
    return this.delegate.acceptQuestFromTemplate(
      template,
      planetId,
      currentDay,
      factionId,
    );
  }

  updateQuestProgress(event: QuestProgressEvent): void {
    this.delegate.updateQuestProgress(event);
  }

  completeQuest(questId: string, player: Player): boolean {
    return this.delegate.completeQuest(questId, player);
  }

  getActiveQuests(): Quest[] {
    return this.delegate.getActiveQuests();
  }

  getCompletedQuestIds(): string[] {
    return this.delegate.getCompletedQuestIds();
  }

  getQuestTemplate(templateId: string): QuestTemplate | undefined {
    return this.delegate.getQuestTemplate(templateId);
  }

  canCompleteQuest(questId: string): boolean {
    return this.delegate.canCompleteQuest(questId);
  }

  getActiveQuestLocations(): string[] {
    return this.delegate.getActiveQuestLocations();
  }

  checkExpiredQuests(currentDay: number, player: Player): Quest[] {
    return this.delegate.checkExpiredQuests(currentDay, player);
  }

  getUrgentQuests(currentDay: number): Quest[] {
    return this.delegate.getUrgentQuests(currentDay);
  }

  restoreState(
    activeQuests: Quest[],
    completedQuestIds: string[],
    completedChainParts?: Record<string, number[]>,
  ): void {
    this.delegate.restoreState(
      activeQuests,
      completedQuestIds,
      completedChainParts,
    );
  }

  forceCompleteQuest(questId: string, player: Player): boolean {
    return this.delegate.forceCompleteQuest(questId, player);
  }

  getExpiredQuests(): Quest[] {
    return this.delegate.getExpiredQuests();
  }

  getCompletedChainParts(): Record<string, number[]> {
    return this.delegate.getCompletedChainParts();
  }
}
