import { NpcRole } from "@/types";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Per-role NPC weapon reach (world px) — the distance from which an engaged NPC
 * of that role can return fire. Replaces the single flat
 * {@link GAME_BALANCE.weaponRange} (240) every NPC used to share, so enemies vary
 * and a long-range player weapon (railgun 360) can no longer trivially out-range
 * *every* foe: a patrol's reach (340) is close enough to the player's best common
 * weapon that the edge is bounded, not infinite.
 *
 * Scaled by role:
 * - TRADER 200 — a defensive popgun (the merchant fights only when cornered);
 * - PIRATE 260 — a mid-range raider;
 * - RANGER 300 — a disciplined mid-long beam;
 * - PATROL 340 — the law's long ballistic reach (just shy of the player's
 *   best common weapon, the railgun's 360);
 * - OVERMIND 340 — hive craft match the patrol's reach (they flew PATROL
 *   stats before gaining their own role, so combat range is preserved).
 *
 * Damage stays per-NPC on {@link NpcShip.damage} (sourced from `ROLE_STATS`), so
 * adding range here is purely catalog/derived — **no save migration** (the value
 * is computed from the already-persisted `role`, never stored).
 */
export const NPC_WEAPON_RANGE: Record<NpcRole, number> = {
  [NpcRole.TRADER]: 200,
  [NpcRole.PIRATE]: 260,
  [NpcRole.RANGER]: 300,
  [NpcRole.PATROL]: 340,
  [NpcRole.OVERMIND]: 340,
};

/**
 * The world-px reach of `npc`'s weapon, by its {@link NpcRole}. Falls back to the
 * legacy flat {@link GAME_BALANCE.weaponRange} for an absent/unknown role so a
 * lightweight stand-in (unit-test sprite) keeps the old behaviour. Pure: derived
 * from the persisted role, no stored field.
 */
export function npcWeaponRange(npc: { role?: NpcRole }): number {
  return (
    (npc.role !== undefined ? NPC_WEAPON_RANGE[npc.role] : undefined) ??
    GAME_BALANCE.weaponRange
  );
}
