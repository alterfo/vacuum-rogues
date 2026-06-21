import type { NpcShip } from "@/domain/NpcShip";
import type { Galaxy } from "@/domain/Galaxy";
import type { SeededRNG } from "@/utils/seededRNG";
import type { NpcGoal } from "@/types";
import { NpcGoalKind, NpcRole } from "@/types";

/**
 * Decides the next goal for an NPC whose current goal is done (or who is IDLE).
 * Default implementation is a deterministic rule-based state machine; an
 * ONNX-backed brain can be swapped in later without touching NpcSimulator
 * (mirrors CombatSystem's EnemyAIController extension point).
 */
export interface NpcBrain {
  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal;
}

/** Map an NPC role to the kind of goal it pursues while travelling. */
function roleToGoalKind(role: NpcRole): NpcGoalKind {
  switch (role) {
    case NpcRole.TRADER:
      return NpcGoalKind.TRADE;
    case NpcRole.PIRATE:
      return NpcGoalKind.HUNT;
    case NpcRole.PATROL:
      return NpcGoalKind.PATROL;
    case NpcRole.RANGER:
    default:
      return NpcGoalKind.TRAVEL;
  }
}

/**
 * Deterministic rule-based brain. Picks a destination system (prefers warp
 * neighbours, falls back to any other system) and a goal kind by role.
 * TRADER NPCs prefer neighbours with a different economy type to simulate
 * purposeful trade routes.
 */
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

    // Traders prefer neighbours with a different economy type so their routes
    // simulate purposeful cargo runs between complementary systems.
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

/**
 * ONNX extension point (Feature 8 hook). Wraps a model registry and falls back
 * to the rule-based brain until a tactical/strategic model is wired in.
 */
export class OnnxNpcBrain implements NpcBrain {
  private readonly fallback = new RuleBasedNpcBrain();

  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal {
    // TODO(Feature 8): query an ONNX policy model; fall back for now.
    return this.fallback.decideGoal(npc, galaxy, rng);
  }
}

// ---------------------------------------------------------------------------
// Pirate shakedown decision ("Кошелёк или жизнь" —
// docs/plans/20260619-universal-comms-and-pirate-encounters.md, Task 2)
// ---------------------------------------------------------------------------

/**
 * Tuning for the pure {@link wantsToShakedown} decision. A bully picks on the
 * weak: the demand chance ramps with the pirate's strength relative to the
 * player and is zero for a pirate the player clearly out-guns.
 */
export const SHAKEDOWN = {
  /** Weight applied to a ship's per-shot damage when scoring its strength. */
  damageWeight: 4,
  /** Below this pirate:player strength ratio a pirate won't bother — chance 0. */
  minRatio: 0.8,
  /** At/above this ratio the demand chance saturates at {@link maxChance}. */
  strongRatio: 1.6,
  /** The most likely a passing pirate is to open a shakedown hail. */
  maxChance: 0.5,
} as const;

/** The minimal combat-stat shape {@link shipCombatStrength} scores. */
export interface ShipCombatStats {
  hullHP: number;
  shields: number;
  damage: number;
}

/**
 * A single combat-strength scalar for a ship: survivability (hull + shields)
 * plus weighted offence (per-shot damage). Used to gauge how a passing pirate
 * sizes up the player before deciding whether to demand tribute. Pure — no RNG,
 * no I/O. Negative inputs are floored at 0 so a wrecked ship never scores below
 * an unarmed one.
 */
export function shipCombatStrength(stats: ShipCombatStats): number {
  const survivability = Math.max(0, stats.hullHP) + Math.max(0, stats.shields);
  const offence = Math.max(0, stats.damage) * SHAKEDOWN.damageWeight;
  return survivability + offence;
}

/**
 * Probability (0–1) that this pirate opens a "кошелёк или жизнь" shakedown hail,
 * given the player's combat strength. Pure: zero for a pirate weaker than
 * {@link SHAKEDOWN.minRatio} of the player, ramping linearly to
 * {@link SHAKEDOWN.maxChance} at/above {@link SHAKEDOWN.strongRatio}. A helpless
 * player (strength ≤ 0) always draws the maximum demand chance.
 */
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

/**
 * Decide whether an already-hostile passing pirate opens a shakedown hail
 * instead of attacking outright. Pure + deterministic given the RNG: only an
 * aggressive PIRATE can demand tribute, and the roll is gated by
 * {@link shakedownChance} (relative strength). Non-pirates, non-hostile ships,
 * and pirates the player out-guns always return false.
 */
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
