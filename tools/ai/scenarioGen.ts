import type { LlmClient, LlmMessage } from "./llmClient";
import { DEFAULT_JUDGE_MODEL } from "./llmClient";
import { extractJson } from "./extractJson";
import {
  SCENARIO_GOALS,
  isScenarioGoal,
  type ScenarioGoal,
} from "../../src/tests/playtest/letsplay/goalBias";

export type { ScenarioGoal };
export { SCENARIO_GOALS };

export interface ScenarioConfig {
  name: string;
  goal: ScenarioGoal;
  maxDays: number;
  seed?: string;
}

export const DEFAULT_SCENARIO_MAX_DAYS = 50;
export const SCENARIO_MAX_DAYS_CAP = 1000;
export const DEFAULT_SCENARIO_COUNT = 5;

export const SCENARIO_RUBRIC = `You are designing a diverse test curriculum for an automated player that exercises a browser space-RPG (a Space Rangers–like trading/combat/quest game). Your goal is to maximise STATE COVERAGE: propose distinct, contrasting playstyles so the player visits parts of the game a single "play sensibly" run never reaches.

Each scenario must pick exactly ONE goal from this FIXED set — use the exact string verbatim:

- go-broke: deliberately spend everything — buy goods, pay for repairs, never bank paid work. Exercise the bankruptcy / negative-balance edge.
- max-rep: court the factions — take their work, avoid combat that would tank reputation. Exercise the reputation ceiling.
- ignore-overmind: refuse to engage the Overmind endgame — trade and settle locally for many days while the threat spreads. Exercise the "galaxy consumed" loss path.
- hoard: stockpile a single good — buy and hold at every market. Exercise the cargo / capacity edge.
- free-explore: just roam — jump to new systems before doing anything local. Exercise breadth of the galaxy.
- trade-magnate: trade for margin, borrowing to fund a bulk buy and repaying promptly after a profitable sale. Exercise the banking + trade loop together.
- gear-grinder: save toward and buy hull/weapon/engine/module upgrades before anything else. Exercise the equipment shop and craft-center paths.
- bounty-hunter: hunt hostiles, loot the kills, sell the loot, repair between fights. Exercise real-time combat + loot economy.
- quest-runner: always carry contracts and route to deliver them. Exercise the quest-delivery flow.
- overmind-slayer: push toward and engage the Overmind core once it has spread. Exercise the endgame arc.
- pirate: raid non-lawful targets, fence loot, avoid lawful factions. Exercise reputation-sensitive combat.
- explorer: roam unvisited systems, belief-aware, banking work locally when credits run low. Exercise galaxy breadth with memory.

Prefer a SPREAD of goals (do not return five of the same). Vary maxDays so some runs are short and some long.

Reply with STRICT JSON and nothing else, in exactly this shape:
{
  "scenarios": [
    {
      "name": "<short label>",
      "goal": "go-broke" | "max-rep" | "ignore-overmind" | "hoard" | "free-explore" | "trade-magnate" | "gear-grinder" | "bounty-hunter" | "quest-runner" | "overmind-slayer" | "pirate" | "explorer",
      "maxDays": <positive integer>,
      "seed": "<optional reproducibility seed string>"
    }
  ]
}`;

export interface ScenarioGenOptions {
  model?: string;
  maxTokens?: number;
}

export function buildScenarioPrompt(count: number): {
  system: string;
  messages: LlmMessage[];
} {
  const n = Number.isFinite(count) && count > 0 ? Math.trunc(count) : DEFAULT_SCENARIO_COUNT;
  return {
    system: SCENARIO_RUBRIC,
    messages: [
      {
        role: "user",
        content: `Propose ${n} diverse play scenarios as JSON. Spread the goals across the fixed set.`,
      },
    ],
  };
}

function coerceMaxDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCENARIO_MAX_DAYS;
  return Math.min(SCENARIO_MAX_DAYS_CAP, Math.max(1, Math.trunc(n)));
}

function coerceScenario(raw: unknown): ScenarioConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const goalRaw =
    typeof obj.goal === "string" ? obj.goal.toLowerCase().trim() : "";
  if (!isScenarioGoal(goalRaw)) return null; // unknown goal → dropped, not thrown
  const goal: ScenarioGoal = goalRaw;

  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : `scenario-${goal}`;
  const maxDays = coerceMaxDays(obj.maxDays);
  const seed =
    typeof obj.seed === "string" && obj.seed.trim() ? obj.seed.trim() : undefined;

  return { name, goal, maxDays, ...(seed ? { seed } : {}) };
}

export function parseScenarios(text: string): ScenarioConfig[] {
  const parsed = extractJson(text ?? "");
  if (parsed === undefined) return [];

  let rawList: unknown;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === "object") {
    rawList = (parsed as Record<string, unknown>).scenarios;
  }
  if (!Array.isArray(rawList)) return [];

  const out: ScenarioConfig[] = [];
  for (const raw of rawList) {
    const cfg = coerceScenario(raw);
    if (cfg) out.push(cfg);
  }
  return out;
}

export async function generateScenarios(
  client: LlmClient,
  count: number = DEFAULT_SCENARIO_COUNT,
  opts: ScenarioGenOptions = {},
): Promise<ScenarioConfig[]> {
  const { system, messages } = buildScenarioPrompt(count);
  const reply = await client.complete(messages, {
    system,
    model: opts.model ?? DEFAULT_JUDGE_MODEL,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
  return parseScenarios(reply);
}
