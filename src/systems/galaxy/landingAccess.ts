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

export const PIRATE_FACTION_ID = "PIRATE";

export const OVERMIND_FACTION_ID: string = Faction.OVERMIND;

export type LandingDenialReason = "overmind" | "pirate-rep";

export interface LandingAccess {
  allowed: boolean;
  reason?: LandingDenialReason;
}

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

export function landingDenialMessage(reason: LandingDenialReason): string {
  switch (reason) {
    case "overmind":
      return t("landing.denial.overmind");
    case "pirate-rep":
      return t("landing.denial.pirateRep");
  }
}

export function grantPirateTributeRep(
  player: Pick<Player, "getReputation" | "adjustReputation">,
): number {
  player.adjustReputation(PIRATE_FACTION_ID, PIRATE_TRIBUTE_REP_GAIN);
  return player.getReputation(PIRATE_FACTION_ID);
}

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

export function standingRecoveryHint(isPirateControlled: boolean): string {
  return isPirateControlled
    ? t("standing.recovery.pirate")
    : t("standing.recovery.faction");
}
