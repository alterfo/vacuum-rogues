import { NpcRole, FactionType } from "@/types";
import type { NpcSizeTier } from "@/types";
import { OVERMIND_SIZE_TIERS } from "@/config/balance";
import { hashStr } from "@/utils/hashStr";

/** Factions a common (non-pirate) NPC may belong to. */
export const FACTIONS: FactionType[] = [
  FactionType.OUTLANDERS,
  FactionType.BASTIONS,
  FactionType.SYNDICATE,
  FactionType.PARADOXES,
  FactionType.PROGRESSORS,
];

/** Roles assigned to the wandering (non-hostile-garrison) NPC population. */
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

/** Base combat stats per role. Exported for the role-map drift guard test. */
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
  // Hostile hive craft: tougher than the law's PATROL hull, but the *base*
  // (medium) tier stays well under the boss override's 450-hull ceiling —
  // size tiers scale from here (plan 20260709 Task 2). Damage deliberately
  // stays at PATROL's 28: the seeded letsplay campaign gates
  // (sessionCompetence) are sensitive to garrison DAMAGE — every +damage
  // point tried (30/34) stalled the agent's power climb below the
  // battle-ready band, while hull/shield buffs pass. Retune damage only with
  // the campaign gates re-run.
  [NpcRole.OVERMIND]: {
    hull: 160,
    shields: 80,
    speed: 0.1,
    damage: 28,
    shieldPower: 5,
  },
};

/** Representative equipment loadout names for each role (shown via scan). */
export const ROLE_LOADOUT: Record<NpcRole, string[]> = {
  [NpcRole.RANGER]: ["Двигатель ур.3", "Генератор поля", "Сканер целей"],
  [NpcRole.TRADER]: ["Двигатель ур.1", "Топливный бак", "Ремонтный дроид"],
  [NpcRole.PIRATE]: ["Двигатель ур.2", "Импульсная пушка", "Радар"],
  [NpcRole.PATROL]: ["Двигатель ур.3", "Генератор поля", "Балистическая пушка"],
  // Hive-craft flavor: the plasma token resolves to the wpn_beam emitter via
  // GearCatalog's LOADOUT_NAME_ALIASES (guarded by lootTokenResolution.test).
  [NpcRole.OVERMIND]: ["Двигатель ур.3", "Генератор поля", "Плазменная пушка"],
};

/**
 * The homogeneous mid-tier band every common NPC's tech is confined to. Most of
 * the galaxy runs similar mid-tech (tech 1–3, centred on 2) — no wild disparities
 * — so a player is never randomly outclassed by a *common* ship. The rare
 * high-end (the apex hull/engine, tech ≥ `RARE_TECH_THRESHOLD` = 6) is reserved
 * for the player's long earned climb and the richest markets; it is **never**
 * seeded onto a common wandering NPC. Keep {@link npcRoleTechLevel}'s range inside
 * this band (the homogeneous-but-expensive economy: see `balance.ts` progression
 * note).
 */
export const NPC_TECH_BAND = { min: 1, max: 3 } as const;

/**
 * Map NpcRole to a tech level documenting the galaxy's homogeneous tech spread.
 * The four roles map to a tight, homogeneous mid-tier spread within
 * {@link NPC_TECH_BAND} (TRADER 1, RANGER/PIRATE 2, PATROL 3) — never the rare
 * apex tier — so the galaxy reads as similarly teched and a fresh player is never
 * outclassed by a *common* ship. (Pure role→tech mapping; the live combat strength
 * of a spawned NPC comes from `ROLE_STATS`, not this helper, since the legacy hex
 * CombatScene was removed — combat is real-time in-flight only.)
 */
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

/**
 * Derive a garrison/capture-fleet Overmind ship's size tier from its id by the
 * {@link OVERMIND_SIZE_TIERS} weights (small most common). Never yields the
 * boss tier — that is reserved for the OVERMIND-core spawn. Deliberately a
 * deterministic id hash, NOT an rng draw: consuming a draw per spawn shifts
 * every downstream roll of the shared seeded rng, which reds the seeded
 * letsplay campaign gates and siege tests; a hash keeps those streams
 * byte-identical while ships still vary (the same trick ship-art variant
 * selection uses).
 */
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
