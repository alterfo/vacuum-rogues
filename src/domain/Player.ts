import type { ReputationMap, QuestLog, Journal } from '@/types';
import type { Race } from './Race';
import type { PlayerShip } from './PlayerShip';
import type { SkillTree } from './SkillTree';
import type { Inventory } from './Inventory';

export class Player {
  constructor(
    public readonly id: string,
    public name: string,
    public readonly race: Race,
    public experience: number,
    public level: number,
    public readonly skillTree: SkillTree,
    public readonly reputation: ReputationMap,
    public readonly questLog: QuestLog,
    public readonly journal: Journal,
    public credits: number,
    public ship: PlayerShip,
    public readonly inventory: Inventory,
    public currentSystemId: string = '',
  ) {}
}
