import { Faction } from "@/types/faction";
import { NpcRole, NpcState } from "@/types";

/**
 * Player-driven liberation of a captured system (the discoverable mid-game
 * counter-play to the Overmind/pirate front). A captured system can be reclaimed
 * by the player the moment its hostile garrison is **cleared** — i.e. after the
 * player has actually fought through the local defenders. This is the immediate,
 * player-earned sibling of the NPC "clear and hold" auto-liberate
 * (`NpcSimulator.resolveLiberationDetection`, which waits LIBERATION_CLEAR_DAYS)
 * and the passive equilibrium recapture (`stepOwnershipTick`). Pure + structural
 * so it covers **both** pirate- and Overmind-captured systems and is unit-testable
 * without PixiJS / the live engine.
 */

/** Minimal ship projection needed to count a present hostile garrison. */
export interface LiberationShipView {
  currentSystemId: string;
  state: NpcState;
  faction: Faction;
  role: NpcRole;
}

/** Minimal galaxy projection the liberation predicate reads (the real `Galaxy`
 *  satisfies it structurally). */
export interface LiberationGalaxyView {
  isHostileSystem(systemId: string): boolean;
  readonly npcShips: ReadonlyArray<LiberationShipView>;
}

/**
 * Count hostile garrison ships **present** (located — not DEAD/TRAVELING) in a
 * system. "Hostile garrison" = an Overmind-faction ship or a pirate-role ship,
 * exactly the set `NpcSimulator.countGarrisonPresent` uses, so the player's
 * "system cleared" verdict matches the simulator's auto-liberate bookkeeping.
 */
export function hostileShipsPresent(
  ships: ReadonlyArray<LiberationShipView>,
  systemId: string,
): number {
  let count = 0;
  for (const n of ships) {
    if (n.currentSystemId !== systemId) continue;
    if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
    if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) count++;
  }
  return count;
}

/**
 * Whether the player may liberate `systemId` right now: it is a captured (hostile)
 * system **and** its hostile garrison is fully cleared. Returns false for a
 * faction-held system (nothing to liberate) or a still-defended captured one (you
 * must win the fight first). This single-system, fight-gated predicate is why
 * liberation cannot auto-clear the map — each call frees at most the one system
 * the player stands in, and only after a real engagement.
 */
export function canPlayerLiberate(
  view: LiberationGalaxyView,
  systemId: string,
): boolean {
  return (
    view.isHostileSystem(systemId) &&
    hostileShipsPresent(view.npcShips, systemId) === 0
  );
}
