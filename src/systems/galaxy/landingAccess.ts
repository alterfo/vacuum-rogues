import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { Faction } from "@/types/faction";

/**
 * Reputation / captured-planet faction id for pirates. Pirates are an NPC role
 * (`NpcRole.PIRATE`) rather than a `Faction`, so their reputation and the
 * control flag on planets they hold are keyed by this string (matching the role
 * value). Shared with the faction-hostility AI plan's "good pirate rep" gate.
 */
export const PIRATE_FACTION_ID = "PIRATE";

/** Why a landing was refused. */
export type LandingDenialReason = "overmind" | "pirate-rep";

export interface LandingAccess {
  allowed: boolean;
  reason?: LandingDenialReason;
}

/**
 * Pure access predicate for landing on a planet, keyed off who controls it.
 *
 * - Uncaptured (`capturedBy === null`) → allowed (as today).
 * - Overmind-captured → never landable (`reason: "overmind"`).
 * - Pirate-captured → landable only when pirate reputation is at/above the
 *   shared good-rep threshold, else blocked (`reason: "pirate-rep"`).
 * - Captured by any other faction → allowed (not gated by this rule).
 *
 * Takes only the fields it reads so it stays trivially testable and decoupled
 * from the full domain objects. `Planet.capturedBy` is typed `FactionType` but
 * in practice carries arbitrary faction-string ids (Overmind / pirate), so it
 * is compared as a string.
 */
export function canLandOnPlanet(
  planet: Pick<Planet, "capturedBy">,
  player: Pick<Player, "getReputation">,
): LandingAccess {
  const captor = (planet.capturedBy as unknown as string | null) ?? null;
  if (captor === null) return { allowed: true };
  if (captor === Faction.OVERMIND)
    return { allowed: false, reason: "overmind" };
  if (captor === PIRATE_FACTION_ID) {
    const rep = player.getReputation(PIRATE_FACTION_ID);
    return rep >= GOOD_PIRATE_REP_THRESHOLD
      ? { allowed: true }
      : { allowed: false, reason: "pirate-rep" };
  }
  return { allowed: true };
}
