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

// ---------------------------------------------------------------------------
// Shakedown resolution — pay / refuse / flee
// (docs/plans/20260619-universal-comms-and-pirate-encounters.md, Task 3)
// ---------------------------------------------------------------------------

/**
 * Tuning for the pure shakedown *outcome* helpers below. Kept separate from the
 * {@link SHAKEDOWN} demand-decision tuning so the tribute size and flee odds can
 * be tuned without touching the "does a pirate demand?" gate.
 */
export const SHAKEDOWN_OUTCOME = {
  /** Fraction of the player's purse a pirate demands as tribute. */
  tributeFraction: 0.25,
  /** Floor on the demand (a pirate won't bother shaking you down for pennies). */
  minTribute: 100,
  /** Cap on the demand so a rich player is never crippled by one hail. */
  maxTribute: 5000,
  /** Escape chance for a much slower ship (the speed ratio is fully unfavourable). */
  fleeMinChance: 0.1,
  /** Escape chance for a much faster ship (the speed ratio is fully favourable). */
  fleeMaxChance: 0.9,
  /** At/below this player:pirate speed ratio the escape chance floors out. */
  fleeSlowRatio: 0.6,
  /** At/above this player:pirate speed ratio the escape chance saturates. */
  fleeFastRatio: 1.4,
} as const;

/**
 * The tribute a pirate demands given the player's current purse. Pure: a fixed
 * fraction of the player's credits, clamped to [{@link SHAKEDOWN_OUTCOME.minTribute},
 * {@link SHAKEDOWN_OUTCOME.maxTribute}] — but never more than the player actually
 * has (a broke player can be emptied, not put into debt). Zero for a penniless
 * player. The result is whole credits (rounded) so the move onto a current account
 * stays save-safe.
 */
export function shakedownTribute(playerCredits: number): number {
  if (playerCredits <= 0) return 0;
  const demand = Math.round(playerCredits * SHAKEDOWN_OUTCOME.tributeFraction);
  const bounded = Math.min(
    Math.max(demand, SHAKEDOWN_OUTCOME.minTribute),
    SHAKEDOWN_OUTCOME.maxTribute,
  );
  return Math.min(bounded, Math.floor(playerCredits));
}

/**
 * Probability (0–1) that the player out-runs a shaking-down pirate by fleeing.
 * Pure function of the two ships' speeds: ramps linearly from
 * {@link SHAKEDOWN_OUTCOME.fleeMinChance} at/below {@link SHAKEDOWN_OUTCOME.fleeSlowRatio}
 * to {@link SHAKEDOWN_OUTCOME.fleeMaxChance} at/above {@link SHAKEDOWN_OUTCOME.fleeFastRatio}
 * of the player:pirate speed ratio. A dead-in-the-water player (speed ≤ 0) can
 * never escape; a motionless pirate (speed ≤ 0) is always escaped.
 */
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

/**
 * Roll whether the player escapes a shakedown by fleeing — pure + deterministic
 * given the RNG, gated by {@link fleeEscapeChance}. A failed roll means the pirate
 * runs the player down and the fight begins.
 */
export function attemptFlee(
  playerSpeed: number,
  pirateSpeed: number,
  rng: SeededRNG,
): boolean {
  return rng.next() < fleeEscapeChance(playerSpeed, pirateSpeed);
}

// ---------------------------------------------------------------------------
// Player hire / ally offers
// (docs/plans/20260619-universal-comms-and-pirate-encounters.md, Task 4)
// ---------------------------------------------------------------------------

/**
 * Tuning for the pure {@link hireFee} / {@link acceptsHire} merc-contract
 * decision. A hired ship sizes up the job: it wants a flat {@link baseFee} just
 * for taking the contract, plus a risk premium proportional to how dangerous the
 * named target is ({@link riskFactor} × the target's combat strength).
 */
export const HIRE = {
  /** Flat fee a hired ship demands just for taking the contract. */
  baseFee: 200,
  /** Risk premium per point of the target's combat strength. */
  riskFactor: 1.5,
} as const;

/**
 * The fee a ship demands to be hired against {@link target}: a flat
 * {@link HIRE.baseFee} plus a risk premium proportional to the target's combat
 * strength (a tougher mark costs more). Pure; whole credits (rounded) so the
 * payment onto a current account stays save-safe.
 */
export function hireFee(target: ShipCombatStats): number {
  const risk = shipCombatStrength(target) * HIRE.riskFactor;
  return Math.round(HIRE.baseFee + risk);
}

/**
 * Decide whether a ship accepts the player's offer of `offer` credits to attack
 * `target` (hire) or aid against it in a fight (ally). Pure — no RNG, no I/O. A
 * ship:
 *  - won't take the coin while it is itself openly hostile to the player
 *    ({@link NpcShip.isAggressive}),
 *  - won't turn its guns on its own faction (no betraying allies), nor on itself,
 *  - otherwise accepts iff the offer meets its {@link hireFee} asking price.
 */
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

/**
 * The goal a freshly-hired ship adopts: HUNT the contracted target's system.
 * Pure — the manager assigns the result to the hired NPC's `goal` so the merc
 * breaks off and heads after the mark (the goal persists via the existing save
 * schema, so no new persistence is needed for the contract to survive a reload).
 */
export function hireGoal(target: NpcShip): NpcGoal {
  return { kind: NpcGoalKind.HUNT, targetSystemId: target.currentSystemId };
}
