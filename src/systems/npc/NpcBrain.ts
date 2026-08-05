import type { NpcShip } from "@/domain/NpcShip";
import type { Galaxy } from "@/domain/Galaxy";
import type { SeededRNG } from "@/utils/seededRNG";
import type { NpcGoal } from "@/types";
import { NpcGoalKind, NpcRole } from "@/types";
import {
  isHostile,
  type FactionKind,
  type HostilityContext,
} from "./factionHostility";

export interface NpcBrain {
  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal;
}

function roleToGoalKind(role: NpcRole): NpcGoalKind {
  switch (role) {
    case NpcRole.TRADER:
      return NpcGoalKind.TRADE;
    case NpcRole.PIRATE:
      return NpcGoalKind.HUNT;
    case NpcRole.PATROL:
    case NpcRole.OVERMIND:
      return NpcGoalKind.PATROL;
    case NpcRole.RANGER:
    default:
      return NpcGoalKind.TRAVEL;
  }
}

export class RuleBasedNpcBrain implements NpcBrain {
  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal {
    const current = galaxy.systems.find((s) => s.id === npc.currentSystemId);

    const neighbours = current
      ? current.connections.map((c) => c.toSystemId)
      : [];
    let pool =
      neighbours.length > 0
        ? neighbours
        : galaxy.systems
            .map((s) => s.id)
            .filter((id) => id !== npc.currentSystemId);

    if (npc.role === NpcRole.TRADER && current && neighbours.length > 0) {
      const differentEconomy = neighbours.filter((id) => {
        const sys = galaxy.systems.find((s) => s.id === id);
        return sys && sys.economyType !== current.economyType;
      });
      if (differentEconomy.length > 0) pool = differentEconomy;
    }

    const targetSystemId =
      pool.length > 0
        ? pool[rng.nextInt(0, pool.length - 1)]
        : npc.currentSystemId;

    return { kind: roleToGoalKind(npc.role), targetSystemId };
  }
}

export class OnnxNpcBrain implements NpcBrain {
  private readonly fallback = new RuleBasedNpcBrain();

  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal {
    return this.fallback.decideGoal(npc, galaxy, rng);
  }
}

export const SHAKEDOWN = {
  damageWeight: 4,
  minRatio: 0.8,
  strongRatio: 1.6,
  maxChance: 0.5,
} as const;

export interface ShipCombatStats {
  hullHP: number;
  shields: number;
  damage: number;
}

export function shipCombatStrength(stats: ShipCombatStats): number {
  const survivability = Math.max(0, stats.hullHP) + Math.max(0, stats.shields);
  const offence = Math.max(0, stats.damage) * SHAKEDOWN.damageWeight;
  return survivability + offence;
}

export interface PirateTargetCandidate {
  readonly id: string;
  readonly kind: FactionKind;
  readonly stats: ShipCombatStats;
}

export function selectPirateTarget(
  candidates: ReadonlyArray<PirateTargetCandidate>,
  ctx: HostilityContext,
): PirateTargetCandidate | null {
  let best: PirateTargetCandidate | null = null;
  let bestStrength = Infinity;
  for (const candidate of candidates) {
    if (!isHostile("pirate", candidate.kind, ctx)) continue;
    const strength = shipCombatStrength(candidate.stats);
    if (strength < bestStrength) {
      best = candidate;
      bestStrength = strength;
    }
  }
  return best;
}

export function shakedownChance(npc: NpcShip, playerStrength: number): number {
  const pirateStrength = shipCombatStrength(npc);
  if (playerStrength <= 0) return SHAKEDOWN.maxChance;
  const ratio = pirateStrength / playerStrength;
  if (ratio < SHAKEDOWN.minRatio) return 0;
  const t = Math.min(
    1,
    (ratio - SHAKEDOWN.minRatio) / (SHAKEDOWN.strongRatio - SHAKEDOWN.minRatio),
  );
  return t * SHAKEDOWN.maxChance;
}

export function wantsToShakedown(
  npc: NpcShip,
  playerStrength: number,
  rng: SeededRNG,
): boolean {
  if (npc.role !== NpcRole.PIRATE || !npc.isAggressive()) return false;
  const chance = shakedownChance(npc, playerStrength);
  if (chance <= 0) return false;
  return rng.next() < chance;
}

export function wantsToShakedownPlayer(
  npc: NpcShip,
  playerStrength: number,
  pirateRep: number,
  rng: SeededRNG,
): boolean {
  if (!isHostile("pirate", "player", { pirateRep })) return false;
  return wantsToShakedown(npc, playerStrength, rng);
}

export const SHAKEDOWN_OUTCOME = {
  tributeFraction: 0.25,
  minTribute: 100,
  maxTribute: 5000,
  fleeMinChance: 0.1,
  fleeMaxChance: 0.9,
  fleeSlowRatio: 0.6,
  fleeFastRatio: 1.4,
} as const;

export function shakedownTribute(playerCredits: number): number {
  if (playerCredits <= 0) return 0;
  const demand = Math.round(playerCredits * SHAKEDOWN_OUTCOME.tributeFraction);
  const bounded = Math.min(
    Math.max(demand, SHAKEDOWN_OUTCOME.minTribute),
    SHAKEDOWN_OUTCOME.maxTribute,
  );
  return Math.min(bounded, Math.floor(playerCredits));
}

export function fleeEscapeChance(
  playerSpeed: number,
  pirateSpeed: number,
): number {
  if (playerSpeed <= 0) return 0;
  if (pirateSpeed <= 0) return 1;
  const ratio = playerSpeed / pirateSpeed;
  const span =
    SHAKEDOWN_OUTCOME.fleeFastRatio - SHAKEDOWN_OUTCOME.fleeSlowRatio;
  const t = Math.min(
    1,
    Math.max(0, (ratio - SHAKEDOWN_OUTCOME.fleeSlowRatio) / span),
  );
  return (
    SHAKEDOWN_OUTCOME.fleeMinChance +
    t * (SHAKEDOWN_OUTCOME.fleeMaxChance - SHAKEDOWN_OUTCOME.fleeMinChance)
  );
}

export function attemptFlee(
  playerSpeed: number,
  pirateSpeed: number,
  rng: SeededRNG,
): boolean {
  return rng.next() < fleeEscapeChance(playerSpeed, pirateSpeed);
}

export const HIRE = {
  baseFee: 200,
  riskFactor: 1.5,
} as const;

export function hireFee(target: ShipCombatStats): number {
  const risk = shipCombatStrength(target) * HIRE.riskFactor;
  return Math.round(HIRE.baseFee + risk);
}

export function acceptsHire(
  npc: NpcShip,
  offer: number,
  target: NpcShip,
): boolean {
  if (npc.isAggressive()) return false;
  if (target.id === npc.id) return false;
  if (target.faction === npc.faction) return false;
  return offer >= hireFee(target);
}

export function hireGoal(target: NpcShip): NpcGoal {
  return { kind: NpcGoalKind.HUNT, targetSystemId: target.currentSystemId };
}
