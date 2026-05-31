import { Race } from '@/domain/Race';
import { RaceType } from '@/types';

/**
 * Registry of all playable races with their unique bonuses and characteristics
 */
export class RaceRegistry {
  private static races: Map<RaceType, Race> = new Map();

  /**
   * Initialize all races with their bonuses
   */
  static initialize(): void {
    // Human - Balanced, trade bonus
    this.races.set(
      RaceType.HUMAN,
      new Race(
        RaceType.HUMAN,
        'Человек',
        { trading: 10, diplomacy: 5 },
        { id: 'human_adaptability', description: 'Адаптивность: +10% к торговле' },
        { tone: 'neutral', formality: 0.5, verbosity: 0.5 },
        { hullHP: 100, shields: 50, energy: 100, speed: 1.0, evasion: 0.8 },
        { buyMultiplier: 0.9, sellMultiplier: 1.1 },
      ),
    );

    // Malok - Combat specialist
    this.races.set(
      RaceType.MALAQAR,
      new Race(
        RaceType.MALAQAR,
        'Малок',
        { tactics: 15, piloting: 10 },
        { id: 'malaqar_warrior', description: 'Воин: +15% урон оружия' },
        { tone: 'aggressive', formality: 0.2, verbosity: 0.3 },
        { hullHP: 120, shields: 60, energy: 90, speed: 0.9, evasion: 0.7 },
        { buyMultiplier: 1.1, sellMultiplier: 0.9 },
      ),
    );

    // Peleng - Scientist
    this.races.set(
      RaceType.PELENG,
      new Race(
        RaceType.PELENG,
        'Пелен',
        { hacking: 20, tactics: 5 },
        { id: 'peleng_scientist', description: 'Учёный: +20% скорость исследований' },
        { tone: 'analytical', formality: 0.8, verbosity: 0.7 },
        { hullHP: 80, shields: 70, energy: 120, speed: 0.8, evasion: 0.9 },
        { buyMultiplier: 1.0, sellMultiplier: 1.0 },
      ),
    );

    // Faerian - Merchant
    this.races.set(
      RaceType.FAERIAN,
      new Race(
        RaceType.FAERIAN,
        'Фэян',
        { trading: 20, diplomacy: 10 },
        { id: 'faerian_merchant', description: 'Торговец: +20% прибыль от торговли' },
        { tone: 'friendly', formality: 0.6, verbosity: 0.8 },
        { hullHP: 90, shields: 45, energy: 110, speed: 1.1, evasion: 0.85 },
        { buyMultiplier: 0.8, sellMultiplier: 1.2 },
      ),
    );

    // Gaalian - Explorer
    this.races.set(
      RaceType.GAALIAN,
      new Race(
        RaceType.GAALIAN,
        'Гаальский',
        { piloting: 15, trading: 5 },
        { id: 'gaalian_explorer', description: 'Исследователь: +15% эффективность топлива' },
        { tone: 'curious', formality: 0.4, verbosity: 0.6 },
        { hullHP: 95, shields: 55, energy: 105, speed: 1.2, evasion: 0.9 },
        { buyMultiplier: 1.0, sellMultiplier: 1.0 },
      ),
    );
  }

  /**
   * Get race by type
   */
  static getRace(type: RaceType): Race {
    const race = this.races.get(type);
    if (!race) {
      throw new Error(`Race not found: ${type}`);
    }
    return race;
  }

  /**
   * Get all races
   */
  static getAllRaces(): Race[] {
    return Array.from(this.races.values());
  }

  /**
   * Get race description in Russian for UI
   */
  static getRaceDescription(type: RaceType): string {
    switch (type) {
      case RaceType.HUMAN:
        return 'Универсальная раса с балансированными характеристиками и бонусом к торговле.';
      case RaceType.MALAQAR:
        return 'Воинственная раса с повышенным уроном и прочностью корпуса.';
      case RaceType.PELENG:
        return 'Технологически развитая раса с бонусом к исследованиям и взлому.';
      case RaceType.FAERIAN:
        return 'Раса торговцев с максимальной прибылью от торговых операций.';
      case RaceType.GAALIAN:
        return 'Раса исследователей с высокой скоростью и экономией топлива.';
      default:
        return 'Неизвестная раса';
    }
  }
}

// Initialize races on module load
RaceRegistry.initialize();
