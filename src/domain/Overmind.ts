import type { StarSystem } from './StarSystem';
import type { Galaxy } from './Galaxy';
import type { OvermindAction } from '@/types';

export class Overmind {
  threatLevel = 1;
  controlledSystems: StarSystem[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public readonly policy: any = null) {}

  makeMove(galaxy: Galaxy): OvermindAction {
    // Placeholder: actual RL policy inference
    const target = galaxy.systems[Math.floor(Math.random() * galaxy.systems.length)];
    return {
      type: 'INVADE',
      targetSystemId: target?.id ?? '',
    };
  }

  evolve(difficultyMultiplier: number): void {
    this.threatLevel = Math.max(1, this.threatLevel * difficultyMultiplier);
  }
}
