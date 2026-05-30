import type { SeededRNG } from './seededRNG';

const SYSTEM_NAMES: string[] = [
  // Russian/Cyrillic astronomical names
  'Солярис',
  'Центавра',
  'Арктур',
  'Вега',
  'Сириус',
  'Альтаир',
  'Денеб',
  'Ригель',
  'Бетельгейзе',
  'Полярис',
  'Капелла',
  'Процион',
  'Альдебаран',
  'Спика',
  'Антарес',
  'Фомальгаут',
  'Мимоза',
  'Акрукс',
  'Регул',
  'Адара',
  // Constellation-based names
  'Андромеда',
  'Кассиопея',
  'Орион',
  'Персей',
  'Лира',
  'Дракон',
  'Феникс',
  'Гидра',
  'Центавр',
  'Скорпион',
  // Sci-fi themed names
  'Нова Прайм',
  'Астра-7',
  'Гелиос',
  'Нептуния',
  'Кронос',
  'Титан',
  'Аврора',
  'Эклипс',
  'Зенит',
  'Надир',
  'Апогей',
  'Перигей',
  'Квазар',
  'Пульсар',
  'Магнетар',
  // Space Ranger themed
  'Рейнджер-1',
  'Форпост',
  'Цитадель',
  'Бастион',
  'Аванпост',
  'Убежище',
  'Приют',
  'Оазис',
  'Маяк',
  'Врата',
];

export class SystemNameGenerator {
  /**
   * Generate unique system names using seeded RNG for deterministic results
   * @param rng Seeded random number generator
   * @param count Number of names to generate
   * @returns Array of unique system names
   */
  static generate(rng: SeededRNG, count: number): string[] {
    if (count > SYSTEM_NAMES.length) {
      throw new Error(`Cannot generate ${count} names, only ${SYSTEM_NAMES.length} available`);
    }

    // Copy array to avoid mutating original
    const names = [...SYSTEM_NAMES];

    // Fisher-Yates shuffle with seeded RNG
    for (let i = names.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [names[i], names[j]] = [names[j], names[i]];
    }

    // Return first 'count' names
    return names.slice(0, count);
  }
}
