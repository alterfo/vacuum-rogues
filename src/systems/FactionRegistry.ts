import { FactionType } from "@/types";

/**
 * Registry of all playable factions with their unique bonuses and characteristics
 */
export interface FactionBonus {
  tradeBonus: string[];
  shipBonus: {
    speed?: number;
    armor?: number;
    shield?: number;
    damage?: number;
  };
  description: string;
}

export class FactionRegistry {
  private static bonuses: Map<FactionType, FactionBonus> = new Map();

  /**
   * Initialize all factions with their bonuses
   */
  static initialize(): void {
    this.bonuses.set(FactionType.OUTLANDERS, {
      tradeBonus: ["supplies", "medkits", "fuel"],
      shipBonus: { armor: 1.3, speed: 0.9 },
      description: "Колонисты окраин с надёжными кораблями",
    });

    this.bonuses.set(FactionType.BASTIONS, {
      tradeBonus: ["weapons", "shields", "armor"],
      shipBonus: { armor: 1.5, damage: 1.2 },
      description: "Воинственная империя с тяжёлыми кораблями",
    });

    this.bonuses.set(FactionType.SYNDICATE, {
      tradeBonus: ["contraband", "cloaking", "stolen_goods"],
      shipBonus: { speed: 1.5, armor: 0.6 },
      description: "Теневая организация контрабандистов",
    });

    this.bonuses.set(FactionType.PARADOXES, {
      tradeBonus: ["unique_modules", "shield_generators"],
      shipBonus: { shield: 1.3, speed: 1.0 },
      description: "Загадочная раса с непредсказуемыми технологиями",
    });

    this.bonuses.set(FactionType.PROGRESSORS, {
      tradeBonus: ["technology", "scanners", "drones"],
      shipBonus: { speed: 1.2, shield: 1.1 },
      description: "Технологически развитая раса исследователей",
    });
  }

  /**
   * Get faction bonus by faction type
   */
  static getBonus(faction: FactionType): FactionBonus {
    const bonus = this.bonuses.get(faction);
    if (!bonus) {
      throw new Error(`Faction bonus not found: ${faction}`);
    }
    return bonus;
  }

  /**
   * Get faction description in Russian for UI
   */
  static getFactionDescription(faction: FactionType): string {
    const bonus = this.bonuses.get(faction);
    return bonus?.description ?? "Неизвестная фракция";
  }
}

// Initialize factions on module load
FactionRegistry.initialize();
