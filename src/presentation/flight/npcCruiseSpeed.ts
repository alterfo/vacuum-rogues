import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Interceptor-class NPCs — OVERMIND craft (the boss faction) or PIRATE raiders.
 * These cruise + pursue at the fast {@link GAME_BALANCE.npcSpeed}; every other
 * (basic) ship uses the slower {@link GAME_BALANCE.npcBasicSpeed}.
 *
 * This is the **same predicate** the garrison-aggro gate uses to decide which
 * sprites turn hostile and chase the player, so the two never drift apart: the
 * ships that hunt you are exactly the ones the starter can't out-run.
 */
export function isInterceptorClass(npc: NpcShip): boolean {
  return npc.faction === Faction.OVERMIND || npc.role === NpcRole.PIRATE;
}

/**
 * Cruise/pursuit speed (px/ms) for an NPC by class: fast for interceptors,
 * slow (out-runnable by a fresh starter ship) for basic traders/patrols.
 */
export function npcCruiseSpeed(npc: NpcShip): number {
  return isInterceptorClass(npc)
    ? GAME_BALANCE.npcSpeed
    : GAME_BALANCE.npcBasicSpeed;
}
