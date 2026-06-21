import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";

/**
 * Faction-hostility matrix — the single source of truth for who-is-hostile-to-whom
 * (docs/plans/20260620-faction-hostility-pirate-overmind-ai.md). Both the
 * off-screen `NpcSimulator` and the in-flight `CombatModule` ask {@link isHostile}
 * so no relation logic is duplicated. Pure: no RNG, no I/O, no PixiJS/DOM deps.
 *
 * The matrix is a function of faction-kind + (for the player) pirate reputation.
 * Relative-strength *target selection* (a pirate picking the weaker of two prey)
 * and solo/pack coordination are layered on top by later tasks — this module only
 * decides the binary enmity relation.
 */

/**
 * The hostility-relevant classification of a combat participant. The Overmind is
 * keyed by faction (its ships carry a `PATROL` role), pirates/traders/rangers/
 * patrols by NPC role, and the human player is its own kind so the good-rep
 * exemption can short-circuit on it.
 */
export type FactionKind =
  | "overmind"
  | "pirate"
  | "trader"
  | "ranger"
  | "patrol"
  | "player";

/**
 * Context the matrix needs beyond the two participants' kinds: the player's
 * pirate reputation (the good-rep exemption) and — for later pack-behaviour
 * tasks — who controls the encounter's system.
 */
export interface HostilityContext {
  /**
   * Player's reputation with the pirate faction (`PIRATE_FACTION_ID`). A player
   * at/above {@link GOOD_PIRATE_REP_THRESHOLD} is left alone by pirates (no
   * attack, no ransom). Ignored for non-player participants.
   */
  readonly pirateRep: number;
  /**
   * Who controls the encounter's system, if captured. Not consulted by the
   * binary enmity relation here; carried for the solo-vs-pack targeting layered
   * on in a later task (`galaxy.pirateSystems` / `galaxy.overmindSystems`).
   */
  readonly systemControl?: "pirate" | "overmind" | null;
}

/**
 * Classify a live NPC ship into its {@link FactionKind}. Overmind ships are
 * tagged by `faction === Faction.OVERMIND` (they fly a `PATROL` role), every
 * other ship by its {@link NpcRole}. Takes only the two fields it reads so it
 * stays trivially testable.
 */
export function factionKindOf(
  npc: Pick<NpcShip, "role" | "faction">,
): Exclude<FactionKind, "player"> {
  if (npc.faction === Faction.OVERMIND) return "overmind";
  switch (npc.role) {
    case NpcRole.PIRATE:
      return "pirate";
    case NpcRole.TRADER:
      return "trader";
    case NpcRole.RANGER:
      return "ranger";
    case NpcRole.PATROL:
      return "patrol";
  }
}

/**
 * Whether a pirate is hostile to `target`. Pirates:
 *  - are mutual enemies of the Overmind,
 *  - prey on weak/valuable targets — traders and the player,
 *  - fight the law (rangers/patrols) that hunt them,
 *  - never attack other pirates (pack),
 *  - **leave a good-rep player alone** (rep at/above the shared threshold).
 */
function pirateHostileTo(target: FactionKind, ctx: HostilityContext): boolean {
  switch (target) {
    case "overmind":
      return true; // mutual enmity
    case "player":
      // Good-rep player is exempt (left alone); otherwise prey.
      return ctx.pirateRep < GOOD_PIRATE_REP_THRESHOLD;
    case "trader":
      return true; // weak/valuable prey
    case "ranger":
    case "patrol":
      return true; // law enforcement — pirates fight back
    case "pirate":
      return false; // pack — never turns on its own
  }
}

/**
 * The hostility matrix: is `attacker` hostile to `target` in `ctx`? Pure and the
 * single source of truth for both the off-screen sim and in-flight combat.
 *
 * - A participant is never hostile to its own kind (pirate pack, Overmind hive,
 *   trader convoy).
 * - **Overmind** attacks everyone non-Overmind indiscriminately (its expansion
 *   goal drives capture; aggression is universal).
 * - **Pirate** — see {@link pirateHostileTo}: enemy of the Overmind, preys on
 *   traders and the (non-good-rep) player, fights the law, exempts a good-rep
 *   player.
 * - **Ranger / Patrol** (law/military) hunt the lawless: pirates and the Overmind.
 * - **Trader / Player** are peaceful in the matrix; their aggression is reactive
 *   (`NpcShip.markHostile` when attacked) and lives outside this pure relation.
 */
export function isHostile(
  attacker: FactionKind,
  target: FactionKind,
  ctx: HostilityContext,
): boolean {
  if (attacker === target) return false; // never fights its own kind
  switch (attacker) {
    case "overmind":
      return true; // indiscriminate — target is non-Overmind here
    case "pirate":
      return pirateHostileTo(target, ctx);
    case "ranger":
    case "patrol":
      return target === "pirate" || target === "overmind";
    case "trader":
    case "player":
      return false; // peaceful; aggression toward them is reactive, not innate
  }
}

/**
 * Convenience over {@link isHostile} for the common NPC-vs-NPC case: classify
 * both ships and ask the matrix. Used by the off-screen sim and in-flight combat
 * to decide cross-faction engagement (e.g. an Overmind ship attacking a pirate).
 */
export function shipsAreHostile(
  attacker: Pick<NpcShip, "role" | "faction">,
  target: Pick<NpcShip, "role" | "faction">,
  ctx: HostilityContext,
): boolean {
  return isHostile(factionKindOf(attacker), factionKindOf(target), ctx);
}
