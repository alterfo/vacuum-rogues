import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";
import { ACTION_ORDER } from "./observe";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import type { PlayerPolicy } from "./PlayerPolicy";
import { featurize } from "./NeuralPolicy";
import type { ScenarioGoal } from "./goalBias";

export interface BcRow {
  readonly features: number[];
  readonly action: number;
}

export interface ExportBcOptions {
  sessions?: number;
  steps?: number;
  seedPrefix?: string;
  policy?: () => PlayerPolicy;
}

async function collectSession(
  seed: string,
  steps: number,
  makePolicy: () => PlayerPolicy,
): Promise<BcRow[]> {
  const harness = await RealEngineHarness.boot({ seed });
  try {
    await harness.newGame();
    const agent = new PlayerAgent(harness, makePolicy());
    const rows: BcRow[] = [];

    for (let step = 0; step < steps; step++) {
      const obs = observe(harness.engine);
      const res = await agent.run(1);
      const action = res.steps[0]?.action;
      if (!action) continue;
      const index = ACTION_ORDER.indexOf(action.kind);
      if (index < 0) continue; // defensive: only log known vocabulary
      rows.push({ features: featurize(obs, agent.belief), action: index });
    }
    return rows;
  } finally {
    harness.dispose();
  }
}

export async function collectBcDataset(
  opts: ExportBcOptions = {},
): Promise<BcRow[]> {
  const sessions = opts.sessions ?? 20;
  const steps = opts.steps ?? 200;
  const seedPrefix = opts.seedPrefix ?? "BC";
  const makePolicy = opts.policy ?? (() => new MemoryHeuristicPolicy());

  const rows: BcRow[] = [];
  for (let i = 0; i < sessions; i++) {
    rows.push(
      ...(await collectSession(`${seedPrefix}-${i}`, steps, makePolicy)),
    );
  }
  return rows;
}

export interface ScenarioMixEntry {
  readonly goal: ScenarioGoal | null;
  readonly sessions: number;
  readonly steps: number;
}

export const DEFAULT_SCENARIO_MIX: readonly ScenarioMixEntry[] = [
  { goal: null, sessions: 200, steps: 500 },
];

export interface ScaleMixOptions {
  sessionsFactor?: number;
  steps?: number;
}

export function scaleScenarioMix(
  mix: readonly ScenarioMixEntry[],
  opts: ScaleMixOptions = {},
): ScenarioMixEntry[] {
  const sessionsFactor = opts.sessionsFactor ?? 1;
  return mix.map((entry) => ({
    goal: entry.goal,
    sessions: Math.max(1, Math.round(entry.sessions * sessionsFactor)),
    steps: opts.steps ?? entry.steps,
  }));
}

export async function collectScenarioMixDataset(
  mix: readonly ScenarioMixEntry[],
  seedPrefix = "BC",
): Promise<BcRow[]> {
  const rows: BcRow[] = [];
  for (const entry of mix) {
    rows.push(
      ...(await collectBcDataset({
        sessions: entry.sessions,
        steps: entry.steps,
        seedPrefix: `${seedPrefix}-${entry.goal ?? "base"}`,
        policy: () =>
          new MemoryHeuristicPolicy(undefined, entry.goal ?? undefined),
      })),
    );
  }
  return rows;
}

export function bcDatasetToJsonl(rows: readonly BcRow[]): string {
  return (
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")
  );
}

export interface WrittenDataset {
  path: string;
  rows: number;
}

export function writeBcDataset(
  rows: readonly BcRow[],
  dir = ".letsplay",
  filename = "bc-dataset.jsonl",
): WrittenDataset {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, bcDatasetToJsonl(rows), "utf8");
  return { path, rows: rows.length };
}
