import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import type { AgentMemory } from "./AgentMemory";

export type ScenarioGoal =
  | "go-broke" // spend it all — shop the market, pay for repairs, don't bank quests
  | "max-rep" // court the factions — take their work, disengage rather than fight
  | "ignore-overmind" // stay out of the war — trade/settle locally, slip away from fights
  | "hoard" // stockpile — buy and hold a good at every market
  | "free-explore" // roam — jump to new systems before anything else
  | "trade-magnate" // CJM-A: trade for margin, borrow/repay to bulk-buy (MemoryHeuristicPolicy)
  | "gear-grinder" // CJM-B: save toward + buy hull/gear/module upgrades (MemoryHeuristicPolicy)
  | "bounty-hunter" // CJM-C: hunt hostiles, loot, sell, repair between fights (MemoryHeuristicPolicy)
  | "quest-runner" // CJM-D: always carry + deliver contracts (MemoryHeuristicPolicy)
  | "overmind-slayer" // CJM-E: push toward and engage the Overmind core (MemoryHeuristicPolicy)
  | "pirate" // CJM-F: raid, avoid lawful factions, fence loot (MemoryHeuristicPolicy)
  | "explorer"; // CJM-G: roam unvisited systems, belief-aware (MemoryHeuristicPolicy)

export const SCENARIO_GOALS: readonly ScenarioGoal[] = [
  "go-broke",
  "max-rep",
  "ignore-overmind",
  "hoard",
  "free-explore",
  "trade-magnate",
  "gear-grinder",
  "bounty-hunter",
  "quest-runner",
  "overmind-slayer",
  "pirate",
  "explorer",
];

export function isScenarioGoal(value: unknown): value is ScenarioGoal {
  return (
    typeof value === "string" &&
    (SCENARIO_GOALS as readonly string[]).includes(value)
  );
}

const GOAL_PREFER: Record<ScenarioGoal, readonly PlayerActionKind[]> = {
  "go-broke": ["trade", "repair"],
  "max-rep": ["take-quest", "flee"],
  "ignore-overmind": ["trade", "land", "flee"],
  hoard: ["trade"],
  "free-explore": ["warp", "move"],
  "trade-magnate": ["repay-loan", "trade", "take-loan"],
  "gear-grinder": ["upgrade-hull", "buy-gear", "buy-module"],
  "bounty-hunter": ["attack", "sell-cargo", "repair"],
  "quest-runner": ["take-quest", "land"],
  "overmind-slayer": ["attack", "warp"],
  pirate: ["attack", "sell-cargo", "flee"],
  explorer: ["warp", "move"],
};

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

    const preferred = GOAL_PREFER[this.goal].find((k) => legal.has(k));
    if (preferred) {
      return {
        kind: preferred,
        targetId: resolveTargetFor(preferred, obs),
        reason: `goal:${this.goal}`,
      };
    }

    return this.base.decide(obs, memory);
  }
}
