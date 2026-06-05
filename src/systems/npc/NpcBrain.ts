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
 */
export class RuleBasedNpcBrain implements NpcBrain {
  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal {
    const current = galaxy.systems.find((s) => s.id === npc.currentSystemId);

    const neighbours = current
      ? current.connections.map((c) => c.toSystemId)
      : [];
    const pool =
      neighbours.length > 0
        ? neighbours
        : galaxy.systems
            .map((s) => s.id)
            .filter((id) => id !== npc.currentSystemId);

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
