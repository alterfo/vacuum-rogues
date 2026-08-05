import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

export function isInterceptorClass(npc: NpcShip): boolean {
  return npc.faction === Faction.OVERMIND || npc.role === NpcRole.PIRATE;
}

export function npcCruiseSpeed(npc: NpcShip): number {
  return isInterceptorClass(npc)
    ? GAME_BALANCE.npcSpeed
    : GAME_BALANCE.npcBasicSpeed;
}
