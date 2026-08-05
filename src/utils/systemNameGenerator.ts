import type { SeededRNG } from "./seededRNG";

const SYSTEM_NAMES: string[] = [
  "Солярис",
  "Центавра",
  "Арктур",
  "Вега",
  "Сириус",
  "Альтаир",
  "Денеб",
  "Ригель",
  "Бетельгейзе",
  "Полярис",
  "Капелла",
  "Процион",
  "Альдебаран",
  "Спика",
  "Антарес",
  "Фомальгаут",
  "Мимоза",
  "Акрукс",
  "Регул",
  "Адара",
  "Андромеда",
  "Кассиопея",
  "Орион",
  "Персей",
  "Лира",
  "Дракон",
  "Феникс",
  "Гидра",
  "Центавр",
  "Скорпион",
  "Нова Прайм",
  "Астра-7",
  "Гелиос",
  "Нептуния",
  "Кронос",
  "Титан",
  "Аврора",
  "Эклипс",
  "Зенит",
  "Надир",
  "Апогей",
  "Перигей",
  "Квазар",
  "Пульсар",
  "Магнетар",
  "Рейнджер-1",
  "Форпост",
  "Цитадель",
  "Бастион",
  "Аванпост",
  "Убежище",
  "Приют",
  "Оазис",
  "Маяк",
  "Врата",
];

export class SystemNameGenerator {
  static generate(rng: SeededRNG, count: number): string[] {
    if (count > SYSTEM_NAMES.length) {
      throw new Error(
        `Cannot generate ${count} names, only ${SYSTEM_NAMES.length} available`,
      );
    }

    const names = [...SYSTEM_NAMES];

    for (let i = names.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [names[i], names[j]] = [names[j], names[i]];
    }

    return names.slice(0, count);
  }
}
