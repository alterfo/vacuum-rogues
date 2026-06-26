import type { Player } from "@/domain/Player";
import { Faction } from "@/types/faction";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import { PIRATE_FACTION_ID } from "@/systems/galaxy/landingAccess";
import type { Encounter, EncounterSystemView, EncounterPlayerState } from "./encounterGenerator"; // prettier-ignore
import type { EncounterOutcome } from "./encounterOutcome";

/**
 * Live-flight wiring for exploration encounters (Task 3) — the thin, **pure**
 * bridge between the pure generator/resolver (`encounterGenerator.ts` /
 * `encounterOutcome.ts`) and the existing engine seams. It deliberately holds
 * **no new economy plumbing**: a resolved payoff is applied through
 * `adjustPlayerCredits` (banking АБС), `Inventory.addResource` (cargo) and
 * `Player.adjustReputation` — the same seams quests/loot already use.
 *
 * No PixiJS/DOM coupling, so the whole money/cargo/rep application is
 * unit-testable; the PixiJS prompt + combat spawn stay in `NpcShipManager`.
 */

/** 0..1 system danger for an Overmind-held system (the most dangerous space). */
const OVERMIND_SYSTEM_DANGER = 1;
/** 0..1 system danger for a pirate-held system. */
const PIRATE_SYSTEM_DANGER = 0.6;

/**
 * Minimal galaxy view the wiring reads — the real `Galaxy` satisfies it
 * structurally. `isOvermindSystem`/`isPirateSystem` lift the encounter
 * rate/danger; `systems[].ownerFaction` picks the rescue's rep beneficiary.
 */
export interface EncounterGalaxyView {
  isOvermindSystem(systemId: string): boolean;
  isPirateSystem(systemId: string): boolean;
  readonly systems: ReadonlyArray<{ id: string; ownerFaction: Faction }>;
}

/**
 * Derive the `0..1` danger scalar the generator scales chance/danger/reward
 * with: an Overmind-held system is max danger, a pirate-held one high, all
 * other space is safe (`0`). Keeps the "0 = safe core, 1 = hostile-held"
 * contract `EncounterSystemView.danger` documents.
 */
export function encounterSystemDanger(
  galaxy: EncounterGalaxyView,
  systemId: string,
): number {
  if (galaxy.isOvermindSystem(systemId)) return OVERMIND_SYSTEM_DANGER;
  if (galaxy.isPirateSystem(systemId)) return PIRATE_SYSTEM_DANGER;
  return 0;
}

/** Project the galaxy into the generator's minimal `EncounterSystemView`. */
export function encounterSystemView(
  galaxy: EncounterGalaxyView,
  systemId: string,
): EncounterSystemView {
  return { id: systemId, danger: encounterSystemDanger(galaxy, systemId) };
}

/** Project the player into the generator's `EncounterPlayerState`. */
export function encounterPlayerStateFor(player: Player): EncounterPlayerState {
  return {
    level: Math.max(1, player.level),
    pirateRep: player.getReputation(PIRATE_FACTION_ID),
  };
}

/**
 * Faction a successful rescue's goodwill flows to: the system owner — but never
 * a hostile/ownerless one (Overmind / Independent), which falls back to the
 * lawful BASTIONS (the patrol/bank faction). Returned as a plain reputation key.
 */
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

/** What the wiring needs to apply a resolved outcome's payoff. */
export interface EncounterApplyDeps {
  bank: BankAccess | null | undefined;
  player: Player;
  galaxy: EncounterGalaxyView;
}

/**
 * Apply a resolved outcome's **non-combat** payoff through the existing seams:
 * signed credits via the banking bus (a positive payout books against the
 * REWARDS GL, a negative repair cost against SERVICES), looted cargo into the
 * hold, and a rescue's reputation onto the system-owner faction. The combat
 * branch (`outcome.startCombat`) is the caller's job — this never spawns ships.
 */
export function applyEncounterOutcome(
  deps: EncounterApplyDeps,
  encounter: Encounter,
  outcome: EncounterOutcome,
): void {
  const { bank, player, galaxy } = deps;

  if (outcome.credits) {
    const counterparty =
      outcome.credits >= 0 ? GL_COUNTERPARTY.REWARDS : GL_COUNTERPARTY.SERVICES;
    adjustPlayerCredits(
      bank,
      player,
      outcome.credits,
      counterparty,
      `Исход встречи (${outcome.kind})`,
    );
  }

  for (const stack of outcome.cargo ?? []) {
    if (stack.amount > 0)
      player.inventory.addResource(stack.type, stack.amount);
  }

  if (outcome.reputationDelta) {
    player.adjustReputation(
      rescueBeneficiaryFaction(galaxy, encounter.systemId),
      outcome.reputationDelta,
    );
  }
}
