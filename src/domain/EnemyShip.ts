import type { EnemyType, Ability, AIProfile } from '@/types';

export class EnemyShip {
  constructor(
    public readonly id: string,
    public readonly type: EnemyType,
    public hullHP: number,
    public shields: number,
    public speed: number,
    public damage: number,
    public isPossessed: boolean,
    public readonly abilities: Ability[],
    public readonly aiProfile: AIProfile,
  ) {}
}
