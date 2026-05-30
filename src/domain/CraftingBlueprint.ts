import type { ResourceCost } from '@/types';
import type { ShipModule } from './ShipModule';
import type { Inventory } from './Inventory';
import { GameBusinessException } from '@/exceptions/GameBusinessException';

export class CraftingBlueprint {
  constructor(
    public readonly id: string,
    public readonly resultModuleId: string,
    public readonly costs: ResourceCost[],
    public readonly requiredSkillLevel: number,
  ) {}

  craft(inventory: Inventory, playerSkillLevel: number): ShipModule {
    if (playerSkillLevel < this.requiredSkillLevel) {
      throw new GameBusinessException(
        'INSUFFICIENT_SKILL',
        `Skill level ${this.requiredSkillLevel} required for crafting.`,
        { required: this.requiredSkillLevel, current: playerSkillLevel },
      );
    }
    if (!inventory.hasResources(this.costs)) {
      throw new GameBusinessException(
        'INSUFFICIENT_RESOURCES',
        'Not enough resources to craft this item.',
        { costs: this.costs },
      );
    }
    inventory.consumeResources(this.costs);
    // Placeholder: actual module creation would look up the result module
    throw new GameBusinessException(
      'NOT_IMPLEMENTED',
      'Module factory not yet integrated.',
      { blueprintId: this.id },
    );
  }
}
