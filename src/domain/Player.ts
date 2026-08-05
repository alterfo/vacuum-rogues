import type {
  ReputationMap,
  QuestLog,
  Journal,
  FactionType,
  GameMode,
  TextQuestState,
} from "@/types";
import type { PlayerShip } from "./PlayerShip";
import type { SkillTree } from "./SkillTree";
import type { Inventory } from "./Inventory";

export class Player {
  contrabandGoods: string[] = [];
  completedQuestChains: string[] = [];
  activeTextQuestState: TextQuestState | null = null;
  newsBookmarks: number[] = [];
  killPoints: number = 0;
  rank: number = 0;
  visitedSystems: string[] = [];
  landedPlanetId: string | null = null;
  readonly gameMode: GameMode = "NORMAL";

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

  get currentAccountId(): string {
    return `cur:${this.id}`;
  }

  getReputation(factionId: string): number {
    return this.reputation[factionId] ?? 0;
  }

  isHostileTo(factionId: string): boolean {
    return this.getReputation(factionId) < -30;
  }

  hasVisited(systemId: string): boolean {
    return this.visitedSystems.includes(systemId);
  }

  markVisited(systemId: string): void {
    if (!this.visitedSystems.includes(systemId)) {
      this.visitedSystems.push(systemId);
    }
  }

  setGameMode(mode: GameMode): void {
    (this as { gameMode: GameMode }).gameMode = mode;
  }

  adjustReputation(factionId: string, delta: number): void {
    const current = this.getReputation(factionId);
    (this.reputation as Record<string, number>)[factionId] = Math.max(
      -100,
      Math.min(100, current + delta),
    );
  }
}
