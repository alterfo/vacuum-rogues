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
  /**
   * The player's loadout — its `cargo` stat caps the hold, so salvage/bonus
   * cargo is clamped to the remaining capacity (mirroring trade + the gravity
   * tractor). Optional: a bare caller/test without a loadout skips the clamp.
   */
  loadout?: ShipLoadout | null;
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
  const { bank, player, galaxy, loadout } = deps;

  if (outcome.credits) {
    // Never overdraw the player into a negative balance: `PlayerSchema.credits`
    // is `int().min(0)`, so a hazard repair cost bigger than the balance would
    // brick the save on reload. Clamp the charge to what the player actually has
    // (the same guard quests use for fines / tribute).
    const delta =
      outcome.credits < 0
        ? -Math.min(-outcome.credits, Math.max(0, player.credits))
        : outcome.credits;
    if (delta !== 0) {
      const counterparty =
        delta >= 0 ? GL_COUNTERPARTY.REWARDS : GL_COUNTERPARTY.SERVICES;
      // `entry.reason` is baked into saved ledger history at transaction time —
      // this Russian label only affects reasons written after this change; no
      // schema/migration is needed, historical entries are display-only text.
      // Shared with the in-flight toast so neither leaks the raw enum kind.
      adjustPlayerCredits(
        bank,
        player,
        delta,
        counterparty,
        `Исход встречи: ${encounterOutcomeMessageRu(outcome)}`,
      );
    }
  }

  // Cargo respects the hold: clamp the total added to the remaining capacity
  // (when a loadout is supplied) so an encounter can't overflow the hold — the
  // same gate trade and the gravity tractor enforce.
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
