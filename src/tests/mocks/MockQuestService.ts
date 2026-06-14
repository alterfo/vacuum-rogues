import type {
  IQuestService,
  QuestProgressEvent,
  QuestTemplate,
} from "@/core/ports/IQuestService";
import type { Quest } from "@/domain/Quest";
import type { Player } from "@/domain/Player";

/**
 * Mock implementation of IQuestService for testing.
 */
export class MockQuestService implements IQuestService {
  public activeQuests: Quest[] = [];
  public completedQuestIds: string[] = [];
  public acceptCallCount = 0;
  public lastTemplateId?: string;
  public progressEvents: QuestProgressEvent[] = [];

  acceptQuest(templateId: string): Quest | null {
    this.acceptCallCount++;
    this.lastTemplateId = templateId;
    return null;
  }

  acceptQuestFromTemplate(template: QuestTemplate): Quest | null {
    this.acceptCallCount++;
    this.lastTemplateId = template.id;
    return null;
  }

  updateQuestProgress(event: QuestProgressEvent): void {
    this.progressEvents.push(event);
  }

  completeQuest(questId: string, _player: Player): boolean {
    return this.activeQuests.some((q) => q.id === questId);
  }

  getActiveQuests(): Quest[] {
    return this.activeQuests;
  }

  getCompletedQuestIds(): string[] {
    return this.completedQuestIds;
  }

  getQuestTemplate(_templateId: string): QuestTemplate | undefined {
    return undefined;
  }

  canCompleteQuest(_questId: string): boolean {
    return false;
  }

  getActiveQuestLocations(): string[] {
    return [];
  }

  checkExpiredQuests(_currentDay: number, _player: Player): Quest[] {
    return [];
  }

  getUrgentQuests(_currentDay: number): Quest[] {
    return [];
  }

  restoreState(
    activeQuests: Quest[],
    completedQuestIds: string[],
    _completedChainParts?: Record<string, number[]>,
    _pendingReturnQuests?: Quest[],
  ): void {
    this.activeQuests = activeQuests;
    this.completedQuestIds = completedQuestIds;
  }

  forceCompleteQuest(_questId: string, _player: Player): boolean {
    return false;
  }

  markObjectivesDone(_questId: string): boolean {
    return false;
  }

  getPendingReturnQuests(): Quest[] {
    return [];
  }

  claimReturnReward(_questId: string, _player: Player): boolean {
    return false;
  }

  getCompletedChainParts(): Record<string, number[]> {
    return {};
  }
}
