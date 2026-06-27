import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Interceptor-class NPCs — OVERMIND craft (the boss faction) or PIRATE raiders.
 * These cruise + pursue at the fast {@link GAME_BALANCE.npcSpeed}; every other
 * (basic) ship uses the slower {@link GAME_BALANCE.npcBasicSpeed}.
 *
 * These are the ships fast enough that a fresh starter can't out-run them. Note
 * the garrison-aggro gate (`NpcShipManager.checkGarrisonAggro`) is now
 * faction-MATCHED to the system's controller (Overmind craft defend hostile
 * systems; pirates defend only pirate-held ones), so it no longer keys off this
 * interceptor predicate — the two are deliberately decoupled.
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
