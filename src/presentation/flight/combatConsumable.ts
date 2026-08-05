export interface CombatConsumableConfig {
  shieldRestoreAmount: number;
  aoeDamage: number;
  aoeRadius: number;
  weaponJamMs: number;
}

export const DEFAULT_COMBAT_CONSUMABLE: CombatConsumableConfig = {
  shieldRestoreAmount: 120,
  aoeDamage: 60,
  aoeRadius: 220,
  weaponJamMs: 4000,
};

export type ConsumableEffectKind =
  | "shield-restore"
  | "aoe-damage"
  | "weapon-jam";

export interface CombatConsumable {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  readonly effect: ConsumableEffectKind;
}

export const COMBAT_CONSUMABLE_CATEGORY_KEY = "combat.consumable.category";

export const COMBAT_CONSUMABLES: readonly CombatConsumable[] = [
  {
    id: "con_shield_cell",
    nameKey: "combat.consumable.shieldCell.name",
    descKey: "combat.consumable.shieldCell.desc",
    effect: "shield-restore",
  },
  {
    id: "con_pulse_bomb",
    nameKey: "combat.consumable.pulseBomb.name",
    descKey: "combat.consumable.pulseBomb.desc",
    effect: "aoe-damage",
  },
  {
    id: "con_jammer",
    nameKey: "combat.consumable.jammer.name",
    descKey: "combat.consumable.jammer.desc",
    effect: "weapon-jam",
  },
] as const;

export function consumableById(
  id: string | null | undefined,
): CombatConsumable | null {
  if (!id) return null;
  return COMBAT_CONSUMABLES.find((c) => c.id === id) ?? null;
}

export function hasConsumable(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

export function consumeOne(ids: readonly string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return [...ids];
  return [...ids.slice(0, i), ...ids.slice(i + 1)];
}

export function applyShieldRestore(
  currentShields: number,
  maxShields: number,
  amount: number = DEFAULT_COMBAT_CONSUMABLE.shieldRestoreAmount,
): number {
  const max = Number.isFinite(maxShields) ? Math.max(0, maxShields) : 0;
  const cur = Number.isFinite(currentShields) ? Math.max(0, currentShields) : 0;
  const restored = cur + Math.max(0, amount);
  return Math.min(max, Math.max(cur, restored));
}

export interface AoeHit<TEnemy> {
  readonly enemy: TEnemy;
  readonly damage: number;
}

export function aoeDamageTargets<TEnemy>(
  center: { x: number; y: number },
  enemies: readonly TEnemy[],
  posOf: (enemy: TEnemy) => { x: number; y: number },
  config: CombatConsumableConfig = DEFAULT_COMBAT_CONSUMABLE,
): AoeHit<TEnemy>[] {
  const radius = Math.max(0, config.aoeRadius);
  const damage = Math.max(0, config.aoeDamage);
  const r2 = radius * radius;
  const hits: AoeHit<TEnemy>[] = [];
  for (const enemy of enemies) {
    const p = posOf(enemy);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    if (dx * dx + dy * dy <= r2) hits.push({ enemy, damage });
  }
  return hits;
}

export interface WeaponJam<TTarget> {
  readonly target: TTarget;
  readonly expiresAtMs: number;
}

export function jamTarget<TTarget>(
  target: TTarget,
  nowMs: number,
  durationMs: number = DEFAULT_COMBAT_CONSUMABLE.weaponJamMs,
): WeaponJam<TTarget> {
  return { target, expiresAtMs: nowMs + Math.max(0, durationMs) };
}

export function isJamActive<TTarget>(
  jam: WeaponJam<TTarget>,
  nowMs: number,
): boolean {
  return nowMs < jam.expiresAtMs;
}
