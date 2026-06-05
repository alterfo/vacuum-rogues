import type { ReputationMap, QuestLog, Journal, FactionType } from "@/types";
import type { PlayerShip } from "./PlayerShip";
import type { SkillTree } from "./SkillTree";
import type { Inventory } from "./Inventory";

export class Player {
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
}
