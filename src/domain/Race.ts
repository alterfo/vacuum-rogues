import type {
  RaceType,
  SkillBonus,
  UniqueMechanic,
  DialogueStyle,
  ShipBaseline,
  TradeModifier,
} from '@/types';

export class Race {
  constructor(
    public readonly type: RaceType,
    public readonly name: string,
    public readonly skillBonuses: SkillBonus,
    public readonly uniqueMechanic: UniqueMechanic,
    public readonly dialogueStyle: DialogueStyle,
    public readonly shipBaseline: ShipBaseline,
    public readonly tradeModifiers: TradeModifier,
  ) {}
}
