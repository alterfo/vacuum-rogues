import type { AxialCoord, StarType } from '@/types';
import { Faction } from '@/types/faction';
import type { Planet } from './Planet';
import type { WarpPath } from './WarpPath';

export class StarSystem {
  explored = false;
  fogOfWar = true;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly coordinates: AxialCoord,
    public readonly starType: StarType,
    public readonly planets: Planet[],
    public readonly ownerFaction: Faction,
    public readonly connections: WarpPath[],
  ) {}

  enter(_player: unknown): void {
    this.explored = true;
    this.fogOfWar = false;
  }
}
