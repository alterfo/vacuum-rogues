import type { QuestType, QuestObjective, Reward, DialogueAnchor } from '@/types';

export class Quest {
  isCompleted = false;

  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly type: QuestType,
    public objectives: QuestObjective[],
    public readonly reward: Reward,
    public readonly dialogueAnchors: DialogueAnchor[],
  ) {}

  updateProgress(event: { objectiveId: string; amount: number }): void {
    const obj = this.objectives.find((o) => o.id === event.objectiveId);
    if (obj && !obj.completed) {
      // Create updated objective to avoid readonly issues on interface
      const updated = {
        ...obj,
        currentAmount: Math.min(obj.currentAmount + event.amount, obj.targetAmount),
      };
      if (updated.currentAmount >= updated.targetAmount) {
        (updated as { completed: boolean }).completed = true;
      }
      this.objectives = this.objectives.map((o) => (o.id === event.objectiveId ? updated : o));
    }
    this.isCompleted = this.objectives.every((o) => o.completed);
  }
}
