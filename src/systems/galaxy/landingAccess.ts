import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import {
  GOOD_PIRATE_REP_THRESHOLD,
  PIRATE_TRIBUTE_REP_GAIN,
} from "@/config/balance";
import { Faction } from "@/types/faction";
import { t } from "@/i18n/i18n";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

/**
 * Reputation / captured-planet faction id for pirates. Pirates are an NPC role
 * (`NpcRole.PIRATE`) rather than a `Faction`, so their reputation and the
 * control flag on planets they hold are keyed by this string (matching the role
 * value). Shared with the faction-hostility AI plan's "good pirate rep" gate.
 */
export const PIRATE_FACTION_ID = "PIRATE";

/**
 * Captured-planet faction id for the Overmind (mirrors {@link PIRATE_FACTION_ID}).
 * Capture is tracked per-*system* (`galaxy.overmindSystems`), so callers that
 * resolve a planet's controller from the galaxy feed this id into the predicate.
 */
export const OVERMIND_FACTION_ID: string = Faction.OVERMIND;

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

/**
 * Player-facing reason a captured-system landing was refused. Resolves through
 * i18n (ru/en lockstep) so the wording localizes; the `pirate-rep` line carries
 * the **recovery hint** (buy off pirates to raise standing) so a blocked player
 * learns *how* to regain access rather than hitting a dead-end.
 */
export function landingDenialMessage(reason: LandingDenialReason): string {
  switch (reason) {
    case "overmind":
      return t("landing.denial.overmind");
    case "pirate-rep":
      return t("landing.denial.pirateRep");
  }
}

/**
 * Apply the pirate-reputation recovery for buying off a shakedown
 * («Откупиться»). Bumps the player's pirate standing by the fixed, capped
 * {@link PIRATE_TRIBUTE_REP_GAIN} (the [-100,100] clamp in `adjustReputation`
 * keeps it from overshooting) and returns the new pirate rep so callers can
 * surface it. This is the **repeatable, credit-costed** path back toward
 * {@link GOOD_PIRATE_REP_THRESHOLD} (landable on pirate-captured systems) — the
 * inverse of the gate above. Pure over a minimal player view so it is unit-
 * testable without the PixiJS comms panel that triggers it.
 */
export function grantPirateTributeRep(
  player: Pick<Player, "getReputation" | "adjustReputation">,
): number {
  player.adjustReputation(PIRATE_FACTION_ID, PIRATE_TRIBUTE_REP_GAIN);
  return player.getReputation(PIRATE_FACTION_ID);
}

/**
 * Pay the customs fine for carrying contraband: charge the (meaningful) `penalty`
 * through the ledger and grant one-time clearance — **without** touching
 * reputation. The old path *also* docked −20 standing, turning a smuggling slip
 * into a permanent rep dead-end with no way back up; standing now recovers only
 * through faction quests (Task 2's reward loop) and the pirate-rep payoff
 * (Task 3), so the fine is a real price, not a one-way spiral. Returns `false`
 * (and books nothing) when the player can't afford it, so the caller can keep the
 * contraband flow intact.
 */
export function payCustomsFine(
  bank: BankAccess | null | undefined,
  player: Player,
  penalty: number,
): boolean {
  if (penalty <= 0) return true;
  if (player.credits < penalty) return false;
  adjustPlayerCredits(
    bank,
    player,
    -penalty,
    GL_COUNTERPARTY.FINES,
    t("customs.fineReason"),
  );
  return true;
}

/**
 * Localized hint telling a low-standing / denied player **how** to climb back, so
 * a customs / hostile-faction / denial surface is never a dead-end. A
 * pirate-held system points at the pirate-rep payoff path (Task 3); every other
 * faction points at completing its quests (Task 2's recovery loop). Pure (just an
 * i18n lookup) so it is trivially testable without the PixiJS planet menu.
 */
export function standingRecoveryHint(isPirateControlled: boolean): string {
  return isPirateControlled
    ? t("standing.recovery.pirate")
    : t("standing.recovery.faction");
}
