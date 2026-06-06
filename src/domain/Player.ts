import type {
  ReputationMap,
  QuestLog,
  Journal,
  FactionType,
  TextQuestState,
} from "@/types";
import type { PlayerShip } from "./PlayerShip";
import type { SkillTree } from "./SkillTree";
import type { Inventory } from "./Inventory";

export class Player {
  /** Resource type IDs (ResourceType strings) bought at a planet where the good was illegal. */
  contrabandGoods: string[] = [];
  /** chainId strings for chains where all 3 parts have been completed. */
  completedQuestChains: string[] = [];
  /** Saved runtime state for the currently active text quest (null when no text quest active). */
  activeTextQuestState: TextQuestState | null = null;
  /** Hashed keys of bookmarked news events (day * 1000 + type-index). */
  newsBookmarks: number[] = [];

  constructor(
    public readonly id: string,
    public name: string,
    public readonly faction: FactionType,
    public experience: number,
    public level: number,
    public readonly skillTree: SkillTree,
    public readonly reputation: ReputationMap,
    public readonly questLog: QuestLog,
    public readonly journal: Journal,
    public credits: number,
    public ship: PlayerShip,
    public readonly inventory: Inventory,
    public currentSystemId: string = "",
  ) {}

  /** Returns reputation score with a faction (0 if never interacted). */
  getReputation(factionId: string): number {
    return this.reputation[factionId] ?? 0;
  }

  /** Returns true when the player is hostile to a faction (score < -30). */
  isHostileTo(factionId: string): boolean {
    return this.getReputation(factionId) < -30;
  }

  /** Adjusts reputation with a faction by delta, clamped to [-100, 100]. */
  adjustReputation(factionId: string, delta: number): void {
    const current = this.getReputation(factionId);
    (this.reputation as Record<string, number>)[factionId] = Math.max(
      -100,
      Math.min(100, current + delta),
    );
  }
}
