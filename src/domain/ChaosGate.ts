import type { StarSystem } from './StarSystem';
import type { Possessed } from './Possessed';

export class ChaosGate {
  public readonly spawnedEnemies: Possessed[] = [];

  constructor(
    public readonly system: StarSystem,
    public daysRemaining: number,
  ) {}

  close(): { credits: number; xp: number; items: unknown[] } {
    return {
      credits: 1000,
      xp: 500,
      items: [],
    };
  }
}
