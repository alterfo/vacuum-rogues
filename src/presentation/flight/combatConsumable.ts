/**
 * Combat consumables (tactical devices) — planning-phase activatable items. Pure, PixiJS-free.
 *
 * Task 9 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). A **`CombatConsumable`** is an
 * activatable tactical item the player carries between fights and activates as a planning-phase
 * action — the {@link import("./combatPlanning").PlannedTurn.consumableId} slot already threads
 * one selected id per turn (Task 2). This module defines the three effects from the spec and the
 * pure resolution math for each; the execute-phase loop consumes them once wired (a later task).
 *
 * **Naming (Task 1 decision 1d, disambiguation):** the code type is `CombatConsumable` and the
 * player-facing category string is **"Тактическое устройство" / "Tactical Device"**. This is
 * deliberately distinct from `ResourceType.ARTIFACTS` — the existing Overmind-loot **crafting
 * currency** consumed by `ARTIFACT_UPGRADE_COSTS`. The two never share a type or an i18n key.
 *
 * **The three effects (spec):**
 * - **shield-restore** — instantly restores shield points (up to the ship's shield max). This is
 *   the first real combat consumer of the ship shield pool (`PlayerShip.shields`/`maxShields`);
 *   {@link applyShieldRestore} defines the clamp-and-never-reduce semantics that Task 12's
 *   shield-vs-hull damage ordering must follow (per the plan's coordination note — whichever of
 *   Task 9 / Task 12 lands first defines the shield-HP semantics; Task 9 lands first).
 *   *(Note: the plan's Task-1 text calls the field `shieldHP`; the actual domain field is
 *   `shields` — this module stays generic over plain `current`/`max` numbers, so the naming
 *   discrepancy is inert here and resolved by whichever field the execute loop passes in.)*
 * - **aoe-damage** — damages **every** enemy within a blast radius of the blast centre, not just a
 *   single selected target ({@link aoeDamageTargets}).
 * - **weapon-jam** — disables one target's fire for a fixed duration, then expires cleanly
 *   ({@link jamTarget} / {@link isJamActive}).
 *
 * **Persistence (Task 1 decision 1d):** the owned-consumable inventory is a small **persisted**
 * list (the player keeps looted consumables between fights) implemented via the
 * additive-optional-field pattern — `Inventory.ownedConsumableIds` (mirroring `ownedGearIds`),
 * `.optional()`/`.default([])` in `schemas.ts`, **no `MigrationPipeline` migration and no
 * `CURRENT_VERSION` bump** (an absent field correctly defaults to an empty inventory). This module
 * itself stays pure — it operates over an opaque id list and generic ship/enemy handles, so it
 * unit-tests standalone, the same discipline as `combatPlanning` / `combatAfterburner` /
 * `combatMissile`. Live tuning comes from `COMBAT_CONSUMABLE` in `balance.ts`; the module mirrors
 * it as {@link DEFAULT_COMBAT_CONSUMABLE}, kept in lockstep by `combatConsumable.test.ts`.
 */

/** Tuning for the three built-in consumable effects; mirrors `COMBAT_CONSUMABLE` in `balance.ts`. */
export interface CombatConsumableConfig {
  /** Shield points a shield-restorer instantly returns (clamped to the ship's shield max). */
  shieldRestoreAmount: number;
  /** Damage the AoE device deals to every enemy inside its blast radius. */
  aoeDamage: number;
  /** Blast radius (world px) the AoE device damages within. */
  aoeRadius: number;
  /** Duration (ms) a weapon-jam device silences the target's fire. */
  weaponJamMs: number;
}

/** Module-local default, mirroring `COMBAT_CONSUMABLE` so this file stays import-light for tests. */
export const DEFAULT_COMBAT_CONSUMABLE: CombatConsumableConfig = {
  shieldRestoreAmount: 120,
  aoeDamage: 60,
  aoeRadius: 220,
  weaponJamMs: 4000,
};

/** The three effect kinds a {@link CombatConsumable} can carry. */
export type ConsumableEffectKind =
  | "shield-restore"
  | "aoe-damage"
  | "weapon-jam";

/**
 * A tactical consumable definition. `effect` names which of the three effects it triggers; the
 * concrete magnitudes come from {@link CombatConsumableConfig} at resolution time so they stay
 * tunable in one place (`balance.ts`) rather than baked per catalog entry.
 */
export interface CombatConsumable {
  /** Catalog id — the value stored in `Inventory.ownedConsumableIds` and `PlannedTurn.consumableId`. */
  readonly id: string;
  /** i18n key for the player-facing name. */
  readonly nameKey: string;
  /** i18n key for the player-facing description. */
  readonly descKey: string;
  /** Which of the three effects this device triggers. */
  readonly effect: ConsumableEffectKind;
}

/** i18n key for the shared player-facing category label ("Тактическое устройство" / "Tactical Device"). */
export const COMBAT_CONSUMABLE_CATEGORY_KEY = "combat.consumable.category";

/**
 * The built-in consumable catalog — one device per effect. Ids are stored in the persisted
 * `Inventory.ownedConsumableIds` list and selected into a turn via `PlannedTurn.consumableId`.
 */
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

/** Look up a consumable definition by id, or null if the id isn't a known consumable. */
export function consumableById(
  id: string | null | undefined,
): CombatConsumable | null {
  if (!id) return null;
  return COMBAT_CONSUMABLES.find((c) => c.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Owned-inventory helpers — pure array ops over the persisted id list. The
// domain `Inventory` holds the real list (see `Inventory.ownedConsumableIds`);
// these mirror that logic for standalone use and tests without a domain import.
// ---------------------------------------------------------------------------

/** True if `ids` contains at least one copy of `id`. */
export function hasConsumable(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

/**
 * Remove the first copy of `id` from `ids`, returning a NEW array (never mutates the input). If
 * `id` isn't present the same-length array is returned — the caller can compare lengths to know
 * whether a consumption happened. This is the "spend one on activation" primitive.
 */
export function consumeOne(ids: readonly string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return [...ids];
  return [...ids.slice(0, i), ...ids.slice(i + 1)];
}

// ---------------------------------------------------------------------------
// Effect resolution — pure functions the execute-phase loop calls once wired.
// ---------------------------------------------------------------------------

/**
 * Shield-restore effect: return the ship's shield value after applying the restore, clamped to
 * `maxShields` and **never reduced** below the current value (a negative/zero config amount is a
 * no-op, not a drain). Non-finite/negative maxima are treated as 0. This is the semantic contract
 * Task 12's shield-vs-hull damage ordering follows.
 */
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

/** A single enemy's share of an AoE blast: the enemy handle plus the damage it takes. */
export interface AoeHit<TEnemy> {
  readonly enemy: TEnemy;
  readonly damage: number;
}

/**
 * AoE-damage effect: return one {@link AoeHit} for **every** enemy whose position is within
 * `radius` (inclusive) of the blast centre — not just a single selected target. Each hit takes the
 * full `damage`. Enemies outside the radius are omitted. `posOf` projects an enemy handle to its
 * world position, keeping the module generic over the concrete ship-sprite type.
 */
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

/** An active weapon-jam: the jammed target and the sim time (ms) at which the jam expires. */
export interface WeaponJam<TTarget> {
  readonly target: TTarget;
  /** Sim-time (ms) at/after which fire resumes. */
  readonly expiresAtMs: number;
}

/**
 * Weapon-jam effect: silence `target`'s fire starting `nowMs` for `durationMs`. Returns the jam
 * record the execute loop tracks; the target's fire gate is suppressed while {@link isJamActive}
 * is true. A non-positive duration yields an already-expired jam (a no-op).
 */
export function jamTarget<TTarget>(
  target: TTarget,
  nowMs: number,
  durationMs: number = DEFAULT_COMBAT_CONSUMABLE.weaponJamMs,
): WeaponJam<TTarget> {
  return { target, expiresAtMs: nowMs + Math.max(0, durationMs) };
}

/**
 * Whether a weapon-jam is still suppressing its target's fire at `nowMs` — true while `nowMs` is
 * strictly before `expiresAtMs`, so the jam expires cleanly the instant the window elapses.
 */
export function isJamActive<TTarget>(
  jam: WeaponJam<TTarget>,
  nowMs: number,
): boolean {
  return nowMs < jam.expiresAtMs;
}
