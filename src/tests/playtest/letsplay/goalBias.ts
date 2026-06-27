/**
 * Letsplay engine — scenario goal-bias seam (dev-only).
 *
 * The deterministic agent plays *free* by default (survive → earn → explore).
 * The offline LLM scenario-generator (`tools/ai/scenarioGen.ts`) widens state
 * coverage by asking for a curriculum of distinct *playstyles* — "go bankrupt",
 * "max reputation", "ignore the Overmind", "hoard one good", "just explore" —
 * which the agent then has to act out. This module is the thin seam that lets it:
 *
 *  - {@link ScenarioGoal} — the **fixed enum the agent understands** (the single
 *    source of truth the scenario parser validates a generated goal against);
 *  - {@link GoalBiasedPolicy} — a {@link PlayerPolicy} *decorator* that wraps any
 *    base policy and nudges its choice toward a goal by preferring a small,
 *    goal-specific set of action kinds **when they are legal**, and otherwise
 *    deferring verbatim to the base policy.
 *
 * The bias is purely additive and legality-preserving: a preferred kind is only
 * taken when `obs.legalActions` permits it, so the decorator can **never** return
 * an illegal action and never throws. With no decorator the agent's default
 * free-play is byte-for-byte unchanged. Dev-only — lives under `src/tests/`.
 */
import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import type { AgentMemory } from "./AgentMemory";

/** The fixed set of play goals a generated scenario can ask the agent to pursue. */
export type ScenarioGoal =
  | "go-broke" // spend it all — shop the market, pay for repairs, don't bank quests
  | "max-rep" // court the factions — take their work, disengage rather than fight
  | "ignore-overmind" // stay out of the war — trade/settle locally, slip away from fights
  | "hoard" // stockpile — buy and hold a good at every market
  | "free-explore"; // roam — jump to new systems before anything else

/** The canonical goal vocabulary (the scenario parser drops anything not in here). */
export const SCENARIO_GOALS: readonly ScenarioGoal[] = [
  "go-broke",
  "max-rep",
  "ignore-overmind",
  "hoard",
  "free-explore",
];

/** Narrow an arbitrary value to a known {@link ScenarioGoal}. */
export function isScenarioGoal(value: unknown): value is ScenarioGoal {
  return (
    typeof value === "string" &&
    (SCENARIO_GOALS as readonly string[]).includes(value)
  );
}

/**
 * Per-goal preferred action kinds, highest priority first. The decorator takes
 * the first preferred kind the current scene actually permits; if none is legal,
 * it falls through to the base policy. Each list is a coherent, constrained
 * playstyle (not exhaustive — the base policy still covers everything else).
 */
const GOAL_PREFER: Record<ScenarioGoal, readonly PlayerActionKind[]> = {
  // Burn credits: shop the market and pay for repairs rather than accept paid work.
  "go-broke": ["trade", "repair"],
  // Court the factions: take their work; disengage rather than fight (combat tanks rep).
  "max-rep": ["take-quest", "flee"],
  // Stay out of the war: trade and settle locally, slip away from fights.
  "ignore-overmind": ["trade", "land", "flee"],
  // Stockpile: buy and hold at every market.
  hoard: ["trade"],
  // Roam: jump to a new system before doing anything local.
  "free-explore": ["warp", "move"],
};

/**
 * Resolve the preferred target id for a chosen `kind`, mirroring the heuristic's
 * own resolution: a landing prefers a planet offering work, a dock the first
 * station, an attack/flee the first hostile. Warp/trade/take-quest targets are
 * left for the agent's applier to resolve from the live engine.
 */
function resolveTargetFor(
  kind: PlayerActionKind,
  obs: Observation,
): string | undefined {
  switch (kind) {
    case "land": {
      const planets = obs.system?.planets ?? [];
      const withWork = planets.find((p) => p.availableQuests > 0);
      return (withWork ?? planets[0])?.id;
    }
    case "dock":
      return obs.system?.stations[0]?.id;
    case "attack":
    case "flee":
      return obs.hostiles[0]?.id;
    default:
      return undefined;
  }
}

/**
 * A {@link PlayerPolicy} decorator that biases a base policy toward a
 * {@link ScenarioGoal}. On each step it tries the goal's preferred action kinds
 * in order and returns the first one the scene permits; if the goal expresses no
 * legal preference for the current state, it defers entirely to the base policy.
 *
 * Pure and total — it adds no state, returns only legal actions, and never
 * throws (the base policy's legality + totality contract is preserved).
 */
export class GoalBiasedPolicy implements PlayerPolicy {
  readonly name: string;

  constructor(
    private readonly base: PlayerPolicy,
    private readonly goal: ScenarioGoal,
  ) {
    this.name = `${base.name}+${goal}`;
  }

  decide(obs: Observation, memory?: AgentMemory): Action {
    const legal = new Set(obs.legalActions);

    // 1) Take the highest-priority goal preference the scene allows…
    const preferred = GOAL_PREFER[this.goal].find((k) => legal.has(k));
    if (preferred) {
      return {
        kind: preferred,
        targetId: resolveTargetFor(preferred, obs),
        reason: `goal:${this.goal}`,
      };
    }

    // 2) …otherwise the goal has nothing to say here — defer to the base brain.
    return this.base.decide(obs, memory);
  }
}
