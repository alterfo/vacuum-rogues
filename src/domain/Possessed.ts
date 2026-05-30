import { EnemyShip } from './EnemyShip';
import type { EnemyType, Ability, AIProfile } from '@/types';

export class Possessed extends EnemyShip {
  public readonly canBeHacked = false;
  public readonly canBeCaptured = false;

  constructor(
    id: string,
    type: EnemyType,
    hullHP: number,
    shields: number,
    speed: number,
    damage: number,
    abilities: Ability[],
    aiProfile: AIProfile,
    public readonly neuroShock: Ability,
    public readonly assimilation: Ability,
  ) {
    super(id, type, hullHP, shields, speed, damage, true, abilities, aiProfile);
  }
}
