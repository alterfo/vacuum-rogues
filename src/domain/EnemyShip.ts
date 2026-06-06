import type { EnemyType, Ability, AIProfile } from "@/types";

export class EnemyShip {
  public readonly maxHull: number;
  /** Turns remaining where shield cannot absorb damage (EMP effect). */
  public shieldDisabledTurns: number = 0;

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
    public readonly techLevel: number = 1,
  ) {
    this.maxHull = hullHP;
  }
}
