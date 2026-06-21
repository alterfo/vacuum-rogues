import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { GameSystemException } from "@/exceptions/GameSystemException";

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
 * pirate reputation (the good-rep exemption). Solo-vs-pack coordination is keyed
 * off system control separately via {@link pirateCoordination}, so it is not
 * carried here.
 */
export interface HostilityContext {
  /**
   * Player's reputation with the pirate faction (`PIRATE_FACTION_ID`). A player
   * at/above {@link GOOD_PIRATE_REP_THRESHOLD} is left alone by pirates (no
   * attack, no ransom). Ignored for non-player participants.
   */
  readonly pirateRep: number;
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
    default: {
      // Exhaustive over the four NpcRole values today; a new role must be
      // classified here rather than silently falling through to `undefined`
      // (which would make every matrix call treat the ship as a non-combatant).
      const unhandled: never = npc.role;
      throw new GameSystemException(
        "FACTION_KIND_UNHANDLED_ROLE",
        `factionKindOf: unhandled NpcRole ${String(unhandled)}`,
        { role: npc.role },
      );
    }
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

/**
 * How pirates coordinate against prey in a given system. Pirates **swarm as a
 * pack** in systems they have captured (`galaxy.pirateSystems`) — their own turf,
 * where they focus-fire a shared mark — and act as **lone raiders (solo)** in any
 * foreign system, each hunting its own quarry independently. Pure decision keyed
 * off the encounter system's control; the single source of truth for the
 * solo-vs-pack split that both the off-screen sim and in-flight combat consult.
 */
export type PirateCoordination = "pack" | "solo";

/**
 * Resolve the pirate {@link PirateCoordination} for a system given who controls
 * it. Only a **pirate-captured** system makes pirates coordinate as a pack; every
 * other control state (overmind-held, contested, or neutral/foreign) leaves them
 * hunting solo. Takes the same `systemControl` value carried by
 * {@link HostilityContext} so callers thread `galaxy.pirateSystems` membership
 * through one place rather than re-deriving the rule.
 */
export function pirateCoordination(
  systemControl: "pirate" | "overmind" | null | undefined,
): PirateCoordination {
  return systemControl === "pirate" ? "pack" : "solo";
}

/**
 * Whether two kinds are **mutual** enemies — each {@link isHostile} to the other.
 * A spontaneous NPC-vs-NPC brawl (a fight that breaks out between two NPCs,
 * independent of the player) requires mutual enmity: a party that both *wants* to
 * attack and is attacked *back*. This naturally excludes the peaceful kinds
 * (`trader`/`player`), which the matrix marks as non-aggressors — a pirate preys on
 * a trader, but the trader never initiates, so that one-sided predation stays in
 * the player-facing / off-screen-raid flow rather than the cross-faction brawl. The
 * single source of truth for who spontaneously fights whom (the in-flight
 * {@link overmindCombatTargets} and the off-screen sim's cross-faction resolution
 * both consult it), so no relation logic is re-derived.
 */
export function mutuallyHostile(
  a: FactionKind,
  b: FactionKind,
  ctx: HostilityContext,
): boolean {
  return isHostile(a, b, ctx) && isHostile(b, a, ctx);
}

/**
 * A combat participant reduced to the fields cross-faction target selection reads:
 * its id, hostility {@link FactionKind}, and live world position.
 */
export interface RangedNpc {
  readonly id: string;
  readonly kind: FactionKind;
  readonly x: number;
  readonly y: number;
}

/**
 * In-flight NPC-vs-NPC engagements for one combat round: for every **Overmind**
 * combatant, the nearest other combatant it is {@link mutuallyHostile} to and
 * within `range` of. This is the Overmind's indiscriminate aggression realised as
 * a real cross-faction brawl in the player's system, independent of the player (a
 * strayed pirate in a captured system, a liberating ranger…). Pure — no RNG, no
 * I/O — and keyed off the shared matrix so the relation is never re-derived.
 *
 * Scoped to **Overmind attackers** this iteration so a system with no Overmind
 * present is wholly unperturbed (bounding the blast radius); the Overmind only
 * spawns in captured/besieging contexts, so the brawl is confined to exactly the
 * warzones where the two sides meet. Returns `attackerId → targetId`, omitting any
 * Overmind with no in-range mutual foe.
 */
export function overmindCombatTargets(
  combatants: readonly RangedNpc[],
  range: number,
  ctx: HostilityContext,
): Map<string, string> {
  const targets = new Map<string, string>();
  const r2 = range * range;
  for (const a of combatants) {
    if (a.kind !== "overmind") continue;
    let bestId: string | null = null;
    let bestD2 = Infinity;
    for (const b of combatants) {
      if (b.id === a.id) continue;
      if (!mutuallyHostile(a.kind, b.kind, ctx)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 < bestD2) {
        bestD2 = d2;
        bestId = b.id;
      }
    }
    if (bestId) targets.set(a.id, bestId);
  }
  return targets;
}
