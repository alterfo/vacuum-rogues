/**
 * Letsplay engine — behavioural-cloning (BC) dataset exporter (dev-only).
 *
 * The neural player ({@link NeuralPolicy}) is trained by **cloning a teacher**:
 * run a known-good {@link PlayerPolicy} (the belief-using {@link
 * MemoryHeuristicPolicy} — the default teacher, since the net's input now carries
 * the memory block) on the *real* {@link GameEngine}, and at every step
 * log the pair `(featurize(obs, belief), actionIndex)` — the net's input vector
 * (including the agent's per-run belief block) and the teacher's chosen action as
 * an index into {@link ACTION_ORDER}. That stream of
 * `(features → label)` rows is a plain supervised-classification dataset: no
 * environment in the training loop, just `tools/ai/train_player.py` fitting the
 * tiny MLP to imitate the teacher, then exporting weights JSON for `mlp.ts`.
 *
 * {@link collectBcDataset} plays `K` sessions × `N` steps on a freshly-booted
 * harness per session and returns the rows in memory; {@link bcDatasetToJsonl}
 * serialises them to JSON-lines (one row per line) and {@link writeBcDataset}
 * persists that to disk (gitignored `.letsplay/`, regenerated each run). The whole
 * run is **deterministic by seed** — the same `seedPrefix` reproduces the same
 * dataset — so a training run is repeatable.
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`); it is not a test file itself (no
 * `vi.mock`), so its caller must have mocked PixiJS — exactly why the data-gen
 * runs through vitest, like the letsplay runner.
 */
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

/**
 * One supervised training example: the {@link featurize} feature vector the
 * teacher saw and the {@link ACTION_ORDER} index of the action it took. A clean
 * `(input, label)` pair for multi-class classification — no reward, no env.
 */
export interface BcRow {
  /** `featurize(obs)` — the net input (FEATURE_LENGTH wide, every value in [0,1]). */
  readonly features: number[];
  /** `ACTION_ORDER.indexOf(action.kind)` — the supervised label (0-based). */
  readonly action: number;
}

/** Knobs for a data-gen run; every field has a sane dev default. */
export interface ExportBcOptions {
  /** Number of sessions (fresh games) to play — `K`. */
  sessions?: number;
  /** Steps the teacher takes per session — `N`. */
  steps?: number;
  /** Seed prefix; each session uses `"<prefix>-<i>"` so runs are reproducible. */
  seedPrefix?: string;
  /**
   * Teacher policy factory — a fresh policy per session. Defaults to the
   * belief-using {@link MemoryHeuristicPolicy} so the cloned labels reason over
   * the same memory block the features carry (a memoryless teacher would train
   * the net to ignore those belief features).
   */
  policy?: () => PlayerPolicy;
}

/** Play one session of `steps` steps on a freshly-booted harness, logging rows. */
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
      // Snapshot the state the teacher is about to act in, then let the agent
      // take exactly one step. `observe` is pure and nothing mutates between
      // here and the agent's own `observe`, so the action it records is the
      // teacher's choice *for this very observation* — the label for these
      // features. (Re-using the agent keeps the real applier as the single
      // source of truth for how an action advances the engine.)
      const obs = observe(harness.engine);
      const res = await agent.run(1);
      const action = res.steps[0]?.action;
      if (!action) continue;
      const index = ACTION_ORDER.indexOf(action.kind);
      if (index < 0) continue; // defensive: only log known vocabulary
      // Featurize with the agent's belief *as the teacher saw it* this step:
      // `run(1)` folds this same observation into the notebook before the teacher
      // decides, so `agent.belief` is exactly the memory block behind the label.
      // (Featurizing without it would record an all-zero belief block and train
      // the net to ignore the memory features this plan added.)
      rows.push({ features: featurize(obs, agent.belief), action: index });
    }
    return rows;
  } finally {
    harness.dispose();
  }
}

/**
 * Play `K` sessions × `N` steps with the teacher policy and return every logged
 * `(features, action)` row — the BC dataset, in memory. Deterministic from the
 * seed: same `seedPrefix` ⇒ same rows. Never throws on a play fault (a thrown
 * applier error lands in the harness sink, not here); each session boots its own
 * real engine so sessions are independent and reproducible.
 */
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

/**
 * One stratum of a {@link collectScenarioMixDataset} run: `sessions` fresh games
 * of `steps` steps each, played by {@link MemoryHeuristicPolicy} biased toward
 * `goal` (or the goal-less base sequencing when `goal` is `null`).
 */
export interface ScenarioMixEntry {
  readonly goal: ScenarioGoal | null;
  readonly sessions: number;
  readonly steps: number;
}

/**
 * The Task 9 stratified mix (`docs/plans/20260701-letsplay-action-expansion-and-neural-scale.md`):
 * ~100K rows spanning every CJM so the dataset labels the net on the full
 * repertoire (trading + banking, equipment/hull upgrades, combat/loot, quest
 * delivery, Overmind engagement, piracy, exploration) plus unbiased base play.
 */
export const DEFAULT_SCENARIO_MIX: readonly ScenarioMixEntry[] = [
  { goal: "trade-magnate", sessions: 30, steps: 500 },
  { goal: "gear-grinder", sessions: 30, steps: 500 },
  { goal: "bounty-hunter", sessions: 30, steps: 500 },
  { goal: "quest-runner", sessions: 20, steps: 500 },
  { goal: "overmind-slayer", sessions: 20, steps: 500 },
  { goal: "pirate", sessions: 20, steps: 500 },
  { goal: "explorer", sessions: 20, steps: 500 },
  { goal: null, sessions: 30, steps: 500 },
];

/**
 * Options for {@link scaleScenarioMix}: dial a mix (typically {@link
 * DEFAULT_SCENARIO_MIX}) up or down without hand-editing every stratum.
 */
export interface ScaleMixOptions {
  /** Multiplies every stratum's `sessions` (rounded, floored at 1). Default `1`. */
  sessionsFactor?: number;
  /** Overrides every stratum's `steps` uniformly, if set. */
  steps?: number;
}

/**
 * Pure transform over a {@link ScenarioMixEntry} list — scales session counts
 * (e.g. for a fast local smoke run of the Task 9 mix) and/or overrides the
 * per-session step count, leaving `goal` untouched. Never returns a
 * zero-session stratum (floors at 1) so every goal still contributes rows.
 */
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

/**
 * Play every {@link ScenarioMixEntry} in `mix` and concatenate the rows into one
 * dataset — each stratum gets its own {@link MemoryHeuristicPolicy} (biased toward
 * its `goal`, or goal-less) and its own seed sub-range (`"<seedPrefix>-<goal
 * or 'base'>-<i>"`) so the whole mix stays deterministic and reproducible while
 * every stratum's sessions are independent of every other stratum's.
 */
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

/**
 * Serialise a BC dataset to **JSON-lines**: one compact JSON object per row,
 * newline-separated (the format `tools/ai/train_player.py` reads). A trailing
 * newline is included so the file is POSIX-clean and appends cleanly.
 */
export function bcDatasetToJsonl(rows: readonly BcRow[]): string {
  return (
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")
  );
}

/** Where a written dataset lands. */
export interface WrittenDataset {
  /** Absolute/relative path to the JSONL file. */
  path: string;
  /** Number of rows written. */
  rows: number;
}

/**
 * Persist a BC dataset to `dir` (default `.letsplay/`, gitignored) as JSONL.
 * Dev-only side-effect used by the data-gen driver; the in-suite test asserts on
 * {@link collectBcDataset} / {@link bcDatasetToJsonl} in memory and does not write.
 */
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
