import { FactionType } from "@/types";

export const FACTION_TITLES: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "ОКРАИННИКИ",
  [FactionType.BASTIONS]: "БАСТИОНЫ",
  [FactionType.SYNDICATE]: "СИНДИКАТ",
  [FactionType.PARADOXES]: "ПАРАДОКСЫ",
  [FactionType.PROGRESSORS]: "ПРОГРЕССОРЫ",
};

export const FACTION_DESCRIPTIONS: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]:
    "Колонисты окраин с надёжными кораблями и бонусом к торговле.",
  [FactionType.BASTIONS]:
    "Воинственная империя с тяжёлыми кораблями и мощным оружием.",
  [FactionType.SYNDICATE]:
    "Теневая организация контрабандистов с быстрыми кораблями.",
  [FactionType.PARADOXES]:
    "Загадочная раса с непредсказуемыми технологиями и уникальными модулями.",
  [FactionType.PROGRESSORS]:
    "Технологически развитая раса исследователей с передовыми системами.",
};

export const FACTION_COLORS: Record<FactionType, number> = {
  [FactionType.OUTLANDERS]: 0xff6600,
  [FactionType.BASTIONS]: 0xcc0000,
  [FactionType.SYNDICATE]: 0x00ff00,
  [FactionType.PARADOXES]: 0x9900ff,
  [FactionType.PROGRESSORS]: 0x0066ff,
};

export const FACTION_STATS: Record<
  FactionType,
  { hull: number; shields: number; speed: number; evasion: number }
> = {
  [FactionType.OUTLANDERS]: {
    hull: 130,
    shields: 45,
    speed: 0.9,
    evasion: 0.75,
  },
  [FactionType.BASTIONS]: { hull: 150, shields: 60, speed: 0.7, evasion: 0.65 },
  [FactionType.SYNDICATE]: { hull: 80, shields: 40, speed: 1.5, evasion: 0.95 },
  [FactionType.PARADOXES]: { hull: 95, shields: 65, speed: 1.0, evasion: 0.85 },
  [FactionType.PROGRESSORS]: {
    hull: 100,
    shields: 55,
    speed: 1.2,
    evasion: 0.9,
  },
};

export const FACTION_BONUSES: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "✦ Надёжность: сниженная стоимость ремонта",
  [FactionType.BASTIONS]: "✦ Военные: +20% урон оружия",
  [FactionType.SYNDICATE]: "✦ Контрабанда: +30% прибыль от нелегальных товаров",
  [FactionType.PARADOXES]: "✦ Непредсказуемость: случайные бонусы в бою",
  [FactionType.PROGRESSORS]: "✦ Технологии: +15% эффективность оборудования",
};
