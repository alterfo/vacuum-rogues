import type { EncounterState, CombatAction } from '@/types';
import type { HexGrid } from './HexGrid';
import type { PlayerShip } from './PlayerShip';
import type { EnemyShip } from './EnemyShip';

export interface Entity {
  readonly id: string;
  readonly speed: number;
  initiative?: number;
}

export class TacticalEncounter {
  public turnNumber = 0;
  public turnOrder: Entity[] = [];
  public state: EncounterState = 'IN_PROGRESS' as EncounterState;
  public currentEntityIndex = 0;

  constructor(
    public readonly id: string,
    public readonly grid: HexGrid,
    public readonly playerShip: PlayerShip,
    public readonly enemies: EnemyShip[],
  ) {}

  start(): void {
    const allEntities: Entity[] = [
      { id: this.playerShip.id, speed: this.playerShip.speed },
      ...this.enemies.map((e) => ({ id: e.id, speed: e.speed })),
    ];
    // Initiative: speed + d20
    allEntities.forEach((e) => {
      e.initiative = e.speed + Math.floor(Math.random() * 20) + 1;
    });
    this.turnOrder = allEntities.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
    this.turnNumber = 1;
    this.currentEntityIndex = 0;
    this.state = 'IN_PROGRESS' as EncounterState;
  }

  processTurn(_entity: Entity, _action: CombatAction): void {
    // Apply action logic in CombatSystem
    this.currentEntityIndex++;
    if (this.currentEntityIndex >= this.turnOrder.length) {
      this.currentEntityIndex = 0;
      this.turnNumber++;
    }
  }

  resolveCombat(): { outcome: EncounterState; xpGained: number; loot: unknown[] } {
    return {
      outcome: this.state,
      xpGained: 0,
      loot: [],
    };
  }
}
