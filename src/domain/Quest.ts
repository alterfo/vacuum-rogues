import type {
  QuestType,
  QuestObjective,
  Reward,
  DialogueAnchor,
} from "@/types";

export interface QuestFailurePenalty {
  readonly reputationLoss: number; // How much reputation to lose on failure
  readonly creditsFine?: number; // Optional fine in credits
  readonly jailTime?: number; // Optional jail time in days
  readonly description: string; // Description of what happens on failure
}

export class Quest {
  isCompleted = false;
  isFailed = false;
  isPendingReturn = false;

  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly type: QuestType,
    public objectives: QuestObjective[],
    public readonly reward: Reward,
    public readonly dialogueAnchors: DialogueAnchor[],
    public readonly planetId: string, // Planet where quest was issued (for reputation tracking)
    public readonly issuedDay: number, // Game day when quest was issued
    public readonly deadline: number, // Days from issuedDay to complete (0 = no deadline)
    public readonly failurePenalty: QuestFailurePenalty | null = null, // Penalty if quest fails or expires
    public readonly targetSystemId: string | null = null,
    public readonly targetObjectId: string | null = null,
    public readonly minReputation: number = 0,
    public readonly chainId: string | null = null,
    public readonly chainPart: number = -1,
    public readonly factionId: string = "",
    public readonly targetPlanetId: string | null = null,
  ) {}

  updateProgress(event: { objectiveId: string; amount: number }): void {
    if (this.isFailed) return; // Can't update progress on failed quest

    const obj = this.objectives.find((o) => o.id === event.objectiveId);
    if (obj && !obj.completed) {
      const updated = {
        ...obj,
        currentAmount: Math.min(
          obj.currentAmount + event.amount,
          obj.targetAmount,
        ),
      };
      if (updated.currentAmount >= updated.targetAmount) {
        (updated as { completed: boolean }).completed = true;
      }
      this.objectives = this.objectives.map((o) =>
        o.id === event.objectiveId ? updated : o,
      );
    }
    this.isCompleted = this.objectives.every((o) => o.completed);
  }

  isExpired(currentDay: number): boolean {
    if (this.deadline === 0) return false; // No deadline
    if (this.isCompleted || this.isFailed || this.isPendingReturn) return false; // Already finished
    return currentDay > this.issuedDay + this.deadline;
  }

  getRemainingDays(currentDay: number): number {
    if (this.deadline === 0) return Infinity;
    return Math.max(0, this.issuedDay + this.deadline - currentDay);
  }

  markAsFailed(): void {
    this.isFailed = true;
  }
}
