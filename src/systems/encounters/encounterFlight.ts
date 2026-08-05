import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { Faction } from "@/types/faction";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { PIRATE_FACTION_ID } from "@/systems/galaxy/landingAccess";
import type { Encounter, EncounterSystemView, EncounterPlayerState } from "./encounterGenerator"; // prettier-ignore
import type { EncounterOutcome } from "./encounterOutcome";
import { encounterOutcomeMessageRu } from "./encounterOutcomeText";

const OVERMIND_SYSTEM_DANGER = 1;
const PIRATE_SYSTEM_DANGER = 0.6;

export interface EncounterGalaxyView {
  isOvermindSystem(systemId: string): boolean;
  isPirateSystem(systemId: string): boolean;
  readonly systems: ReadonlyArray<{ id: string; ownerFaction: Faction }>;
}

export function encounterSystemDanger(
  galaxy: EncounterGalaxyView,
  systemId: string,
): number {
  if (galaxy.isOvermindSystem(systemId)) return OVERMIND_SYSTEM_DANGER;
  if (galaxy.isPirateSystem(systemId)) return PIRATE_SYSTEM_DANGER;
  return 0;
}

export function encounterSystemView(
  galaxy: EncounterGalaxyView,
  systemId: string,
): EncounterSystemView {
  return { id: systemId, danger: encounterSystemDanger(galaxy, systemId) };
}

export function encounterPlayerStateFor(player: Player): EncounterPlayerState {
  return {
    level: Math.max(1, player.level),
    pirateRep: player.getReputation(PIRATE_FACTION_ID),
  };
}

export function rescueBeneficiaryFaction(
  galaxy: EncounterGalaxyView,
  systemId: string,
): string {
  const owner = galaxy.systems.find((s) => s.id === systemId)?.ownerFaction;
  if (!owner || owner === Faction.OVERMIND || owner === Faction.INDEPENDENT) {
    return Faction.BASTIONS;
  }
  return owner;
}

export interface EncounterApplyDeps {
  bank: BankAccess | null | undefined;
  player: Player;
  galaxy: EncounterGalaxyView;
  loadout?: ShipLoadout | null;
}

export function applyEncounterOutcome(
  deps: EncounterApplyDeps,
  encounter: Encounter,
  outcome: EncounterOutcome,
): void {
  const { bank, player, galaxy, loadout } = deps;

  if (outcome.credits) {
    const delta =
      outcome.credits < 0
        ? -Math.min(-outcome.credits, Math.max(0, player.credits))
        : outcome.credits;
    if (delta !== 0) {
      const counterparty =
        delta >= 0 ? GL_COUNTERPARTY.REWARDS : GL_COUNTERPARTY.SERVICES;
      adjustPlayerCredits(
        bank,
        player,
        delta,
        counterparty,
        `Исход встречи: ${encounterOutcomeMessageRu(outcome)}`,
      );
    }
  }

  let freeHold =
    loadout != null
      ? Math.max(
          0,
          cargoCapacityOf(loadout) -
            player.inventory.resources.reduce((sum, r) => sum + r.amount, 0),
        )
      : Number.POSITIVE_INFINITY;
  for (const stack of outcome.cargo ?? []) {
    if (stack.amount <= 0) continue;
    const add = Math.min(stack.amount, freeHold);
    if (add <= 0) break;
    player.inventory.addResource(stack.type, add);
    freeHold -= add;
  }

  if (outcome.reputationDelta) {
    player.adjustReputation(
      rescueBeneficiaryFaction(galaxy, encounter.systemId),
      outcome.reputationDelta,
    );
  }
}
