import { dirname, basename } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { logger } from "@/utils/logger";
import { ACTION_ORDER } from "./observe";
import { FEATURE_LENGTH } from "./NeuralPolicy";
import {
  collectScenarioMixDataset,
  scaleScenarioMix,
  DEFAULT_SCENARIO_MIX,
  writeBcDataset,
  type BcRow,
} from "./exportBcData";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function posFloatEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function posIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function logActionHistogram(rows: readonly BcRow[]): void {
  const counts = new Array(ACTION_ORDER.length).fill(0) as number[];
  for (const r of rows) counts[r.action] += 1;
  for (let i = 0; i < ACTION_ORDER.length; i++) {
    const pct = ((counts[i] / rows.length) * 100).toFixed(1);
    logger.info(`  [${i}] ${ACTION_ORDER[i]}: ${counts[i]} (${pct}%)`);
  }
}

describe("scenario-mix dataset export wiring (always-on, tiny)", () => {
  it("plays a tiny stratified mix and produces well-formed rows", async () => {
    const rows = await collectScenarioMixDataset(
      [
        { goal: "bounty-hunter", sessions: 1, steps: 4 },
        { goal: null, sessions: 1, steps: 3 },
      ],
      "SCENARIO_MIX_EXPORT_WIRING",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.features).toHaveLength(FEATURE_LENGTH);
      expect(row.action).toBeGreaterThanOrEqual(0);
      expect(row.action).toBeLessThan(ACTION_ORDER.length);
    }
  }, 60_000);
});

const EXPORT_MIX = process.env.LETSPLAY_EXPORT_MIX === "1";
describe.runIf(EXPORT_MIX)(
  "npm run dataset:export — Task 9 stratified CJM dataset",
  () => {
    it("plays the full mix and writes the JSONL dataset", async () => {
      const sessionsScale = posFloatEnv(
        process.env.LETSPLAY_EXPORT_MIX_SESSIONS_SCALE,
        1,
      );
      const stepsOverride = process.env.LETSPLAY_EXPORT_MIX_STEPS
        ? posIntEnv(process.env.LETSPLAY_EXPORT_MIX_STEPS, 500)
        : undefined;
      const seedPrefix = process.env.LETSPLAY_EXPORT_MIX_SEED_PREFIX ?? "BC";
      const output =
        process.env.LETSPLAY_EXPORT_MIX_OUTPUT ??
        "tools/ai/dataset/train.jsonl";

      const mix = scaleScenarioMix(DEFAULT_SCENARIO_MIX, {
        sessionsFactor: sessionsScale,
        ...(stepsOverride ? { steps: stepsOverride } : {}),
      });

      const totalSessions = mix.reduce((n, e) => n + e.sessions, 0);
      const plannedRows = mix.reduce((n, e) => n + e.sessions * e.steps, 0);
      logger.info(
        `dataset:export — ${mix.length} strata, ${totalSessions} sessions, ~${plannedRows} rows planned`,
      );

      const rows = await collectScenarioMixDataset(mix, seedPrefix);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.features).toHaveLength(FEATURE_LENGTH);
        expect(row.action).toBeGreaterThanOrEqual(0);
        expect(row.action).toBeLessThan(ACTION_ORDER.length);
      }

      const written = writeBcDataset(rows, dirname(output), basename(output));
      logger.info(
        `dataset:export — wrote ${written.rows} rows to ${written.path}`,
      );
      logActionHistogram(rows);

      const seenActions = new Set(rows.map((r) => r.action));
      const deadHeads = ACTION_ORDER.filter((_, i) => !seenActions.has(i));
      if (deadHeads.length > 0) {
        logger.warn(
          `dataset:export — no rows for action kind(s): ${deadHeads.join(", ")}`,
        );
      }
    }, 3_600_000); // up to 1h for the full-scale mix
  },
);
