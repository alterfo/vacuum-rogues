import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { GameSystemException } from "@/exceptions/GameSystemException";

export type FactionKind =
  | "overmind"
  | "pirate"
  | "trader"
  | "ranger"
  | "patrol"
  | "player";

export interface HostilityContext {
  readonly pirateRep: number;
}

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
    case NpcRole.OVERMIND:
      return "overmind";
    default: {
      const unhandled: never = npc.role;
      throw new GameSystemException(
        "FACTION_KIND_UNHANDLED_ROLE",
        `factionKindOf: unhandled NpcRole ${String(unhandled)}`,
        { role: npc.role },
      );
    }
  }
}

function pirateHostileTo(target: FactionKind, ctx: HostilityContext): boolean {
  switch (target) {
    case "overmind":
      return true; // mutual enmity
    case "player":
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

export function shipsAreHostile(
  attacker: Pick<NpcShip, "role" | "faction">,
  target: Pick<NpcShip, "role" | "faction">,
  ctx: HostilityContext,
): boolean {
  return isHostile(factionKindOf(attacker), factionKindOf(target), ctx);
}

export type PirateCoordination = "pack" | "solo";

export function pirateCoordination(
  systemControl: "pirate" | "overmind" | null | undefined,
): PirateCoordination {
  return systemControl === "pirate" ? "pack" : "solo";
}

export function mutuallyHostile(
  a: FactionKind,
  b: FactionKind,
  ctx: HostilityContext,
): boolean {
  return isHostile(a, b, ctx) && isHostile(b, a, ctx);
}

export interface RangedNpc {
  readonly id: string;
  readonly kind: FactionKind;
  readonly x: number;
  readonly y: number;
}

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
