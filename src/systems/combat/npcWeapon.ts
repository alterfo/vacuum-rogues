import { NpcRole } from "@/types";
import { GAME_BALANCE } from "@/config/balance";

export const NPC_WEAPON_RANGE: Record<NpcRole, number> = {
  [NpcRole.TRADER]: 200,
  [NpcRole.PIRATE]: 260,
  [NpcRole.RANGER]: 300,
  [NpcRole.PATROL]: 340,
  [NpcRole.OVERMIND]: 340,
};

export function npcWeaponRange(npc: { role?: NpcRole }): number {
  return (
    (npc.role !== undefined ? NPC_WEAPON_RANGE[npc.role] : undefined) ??
    GAME_BALANCE.weaponRange
  );
}
