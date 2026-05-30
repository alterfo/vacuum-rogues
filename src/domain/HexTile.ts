import type { AxialCoord, TileType } from '@/types';

export class HexTile {
  type: TileType = 'EMPTY' as TileType;
  elevation = 0;
  occupant: unknown = null;
  coverBonus = 0;
  accuracyPenalty = 0;

  constructor(public readonly coord: AxialCoord) {}
}
