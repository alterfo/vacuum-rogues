/**
 * Offline LLM scenario-generator (dev-only, `tools/`-resident — never in the prod
 * bundle or the pre-push gate).
 *
 * The oddity-judge (`oddityJudge.ts`) is only as good as how much of the game's
 * state space the agent actually visits. This module widens that coverage: it
 * asks Claude (through the injectable {@link LlmClient}) for a diverse *curriculum*
 * of play scenarios and parses the reply into machine-readable {@link ScenarioConfig}s
 * the agent can execute via the {@link GoalBiasedPolicy} goal-bias seam.
 *
 * Each scenario pins ONE {@link ScenarioGoal} from the fixed enum the agent
 * understands — the parser validates against {@link SCENARIO_GOALS} and **drops**
 * (never crashes on) an unknown goal — plus an optional seed and a bounded day
 * budget. Three pure pieces, all unit-tested against a fake client (no live call):
 *
 *  - {@link buildScenarioPrompt} — assemble the system rubric + the count request;
 *  - {@link parseScenarios} — turn the model reply into a clean config list,
 *    robust to a malformed reply (degrades to `[]`, never throws);
 *  - {@link generateScenarios} — the async glue: prompt → `client.complete` → parse.
 *
 * **Dev-only.** Imported by no production module (enforced by `letsplayDevOnly.test.ts`).
 */
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

/** A machine-readable play scenario the agent can execute. */
export interface ScenarioConfig {
  /** Short human label for transcripts / reports. */
  name: string;
  /** The playstyle the {@link GoalBiasedPolicy} biases toward. */
  goal: ScenarioGoal;
  /** Bounded galaxy-day budget for the run. */
  maxDays: number;
  /** Optional seed so a scenario is reproducible (the runner picks it). */
  seed?: string;
}

/** Day budget for a scenario that omits / mis-states `maxDays`. */
export const DEFAULT_SCENARIO_MAX_DAYS = 50;
/** Hard upper bound on a scenario's day budget (a guard against an absurd reply). */
export const SCENARIO_MAX_DAYS_CAP = 1000;
/** Default number of scenarios requested when the caller does not specify. */
export const DEFAULT_SCENARIO_COUNT = 5;

/**
 * The scenario rubric — the system prompt. It enumerates the exact goal strings
 * the agent understands and pins the JSON reply shape the parser expects.
 */
export const SCENARIO_RUBRIC = `You are designing a diverse test curriculum for an automated player that exercises a browser space-RPG (a Space Rangers–like trading/combat/quest game). Your goal is to maximise STATE COVERAGE: propose distinct, contrasting playstyles so the player visits parts of the game a single "play sensibly" run never reaches.

Each scenario must pick exactly ONE goal from this FIXED set — use the exact string verbatim:

- go-broke: deliberately spend everything — buy goods, pay for repairs, never bank paid work. Exercise the bankruptcy / negative-balance edge.
- max-rep: court the factions — take their work, avoid combat that would tank reputation. Exercise the reputation ceiling.
- ignore-overmind: refuse to engage the Overmind endgame — trade and settle locally for many days while the threat spreads. Exercise the "galaxy consumed" loss path.
- hoard: stockpile a single good — buy and hold at every market. Exercise the cargo / capacity edge.
- free-explore: just roam — jump to new systems before doing anything local. Exercise breadth of the galaxy.

Prefer a SPREAD of goals (do not return five of the same). Vary maxDays so some runs are short and some long.

Reply with STRICT JSON and nothing else, in exactly this shape:
{
  "scenarios": [
    {
      "name": "<short label>",
      "goal": "go-broke" | "max-rep" | "ignore-overmind" | "hoard" | "free-explore",
      "maxDays": <positive integer>,
      "seed": "<optional reproducibility seed string>"
    }
  ]
}`;

/** Options for {@link generateScenarios} — model + token cap overrides. */
export interface ScenarioGenOptions {
  /** Override the client's model for this generation call. */
  model?: string;
  /** Hard cap on the model's output tokens. */
  maxTokens?: number;
}

/**
 * Assemble the scenario-generation prompt: the {@link SCENARIO_RUBRIC} as the
 * system message and a single user message asking for `count` scenarios. Pure.
 */
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

/** Clamp a raw `maxDays` to a sane positive integer, defaulting an absent/bad value. */
function coerceMaxDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCENARIO_MAX_DAYS;
  return Math.min(SCENARIO_MAX_DAYS_CAP, Math.max(1, Math.trunc(n)));
}

/**
 * Coerce one raw object into a {@link ScenarioConfig}, or `null` when it cannot
 * be a valid scenario. An **unknown goal is dropped** (returns `null`) rather
 * than crashing the whole parse — the load-bearing robustness this module owes
 * the agent (the agent only understands {@link SCENARIO_GOALS}).
 */
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

/**
 * Parse a model reply into a list of {@link ScenarioConfig}s. **Robust:** a reply
 * that isn't the expected JSON — empty, prose, truncated, the wrong shape —
 * degrades to an empty list; individual unknown/unusable entries are dropped, the
 * good ones kept. Never throws. Accepts either `{ "scenarios": [...] }` or a bare
 * `[...]` of scenarios.
 */
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

/**
 * Ask the model for `count` diverse scenarios and parse the reply into
 * {@link ScenarioConfig}s. The client throwing (e.g. the missing-key guard)
 * propagates; a *returned but malformed* reply degrades to `[]` via
 * {@link parseScenarios}.
 */
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
