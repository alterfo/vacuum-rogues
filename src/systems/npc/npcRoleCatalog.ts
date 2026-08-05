import { NpcRole, FactionType } from "@/types";
import type { NpcSizeTier } from "@/types";
import { OVERMIND_SIZE_TIERS } from "@/config/balance";
import { hashStr } from "@/utils/hashStr";

export const FACTIONS: FactionType[] = [
  FactionType.OUTLANDERS,
  FactionType.BASTIONS,
  FactionType.SYNDICATE,
  FactionType.PARADOXES,
  FactionType.PROGRESSORS,
];

export const ROLES: NpcRole[] = [
  NpcRole.RANGER,
  NpcRole.TRADER,
  NpcRole.PIRATE,
  NpcRole.PATROL,
];

export const FACTION_NAME: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "Окраинник",
  [FactionType.BASTIONS]: "Бастион",
  [FactionType.SYNDICATE]: "Синдикат",
  [FactionType.PARADOXES]: "Парадокс",
  [FactionType.PROGRESSORS]: "Прогрессор",
};

export const ROLE_NAME: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "Рейнджер",
  [NpcRole.TRADER]: "Торговец",
  [NpcRole.PIRATE]: "Пират",
  [NpcRole.PATROL]: "Патруль",
  [NpcRole.OVERMIND]: "Жнец",
};

export const ROLE_STATS: Record<
  NpcRole,
  {
    hull: number;
    shields: number;
    speed: number;
    damage: number;
    shieldPower: number;
  }
> = {
  [NpcRole.RANGER]: {
    hull: 120,
    shields: 60,
    speed: 0.1,
    damage: 25,
    shieldPower: 3,
  },
  [NpcRole.TRADER]: {
    hull: 100,
    shields: 30,
    speed: 0.08,
    damage: 10,
    shieldPower: 1,
  },
  [NpcRole.PIRATE]: {
    hull: 110,
    shields: 40,
    speed: 0.12,
    damage: 30,
    shieldPower: 2,
  },
  [NpcRole.PATROL]: {
    hull: 140,
    shields: 70,
    speed: 0.1,
    damage: 28,
    shieldPower: 4,
  },
  [NpcRole.OVERMIND]: {
    hull: 160,
    shields: 80,
    speed: 0.1,
    damage: 28,
    shieldPower: 5,
  },
};

export const ROLE_LOADOUT: Record<NpcRole, string[]> = {
  [NpcRole.RANGER]: ["Двигатель ур.3", "Генератор поля", "Сканер целей"],
  [NpcRole.TRADER]: ["Двигатель ур.1", "Топливный бак", "Ремонтный дроид"],
  [NpcRole.PIRATE]: ["Двигатель ур.2", "Импульсная пушка", "Радар"],
  [NpcRole.PATROL]: ["Двигатель ур.3", "Генератор поля", "Балистическая пушка"],
  [NpcRole.OVERMIND]: ["Двигатель ур.3", "Генератор поля", "Плазменная пушка"],
};

export const NPC_TECH_BAND = { min: 1, max: 3 } as const;

export function npcRoleTechLevel(role: NpcRole): number {
  const map: Record<NpcRole, number> = {
    [NpcRole.PATROL]: 3,
    [NpcRole.OVERMIND]: 3,
    [NpcRole.RANGER]: 2,
    [NpcRole.PIRATE]: 2,
    [NpcRole.TRADER]: 1,
  };
  return map[role] ?? 1;
}

export function overmindSizeTierForId(id: string): NpcSizeTier {
  const tiers = Object.entries(OVERMIND_SIZE_TIERS) as [
    NpcSizeTier,
    { statMult: number; weight: number },
  ][];
  const total = tiers.reduce((sum, [, t]) => sum + t.weight, 0);
  let roll = (hashStr(id) % total) + 1;
  for (const [tier, t] of tiers) {
    roll -= t.weight;
    if (roll <= 0) return tier;
  }
  return "medium";
}
