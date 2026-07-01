/**
 * Task 9 of the letsplay action-expansion + neural scale-up plan
 * (`docs/plans/20260701-letsplay-action-expansion-and-neural-scale.md`): the
 * `npm run dataset:export` driver for the stratified CJM dataset.
 *
 * Deviation from the plan's illustrative `npx tsx src/tests/playtest/letsplay/
 * exportBcData.ts` command: `exportBcData.ts` boots the real engine through
 * `src/assets/manifest.ts`'s `import.meta.glob` (a Vite-only API) and needs
 * PixiJS mocked (`vi.mock("pixi.js")`) — neither works under bare `tsx`/node
 * (verified: a plain `tsx` run throws `TypeError: (intermediate value).glob is
 * not a function` at the manifest import). Every other engine-bound driver in
 * this codebase (`letsplay:ci`, `letsplay:judge`) is therefore an env-gated
 * Vitest runner rather than a raw script — this follows the same shape, and
 * `--output` becomes an env var for the same reason `letsplay:judge`'s knobs are
 * `LETSPLAY_JUDGE_SESSIONS`/`_STEPS`/`_MODEL` rather than CLI flags.
 *
 * This is a **separate** driver from the older `exportDataset.run.test.ts`
 * (`GEN_BC=1`, from the superseded `20260627-letsplay-full-game-play-and-net-
 * retrain.md` plan this one supersedes): that file's goal vocabulary (free-
 * explore/max-rep/hoard) and `.letsplay/` output predate Task 4's CJM teacher
 * behaviors and Task 5's 50-wide featurize, so it is left untouched (its
 * always-on smoke assertion is not this plan's to touch) rather than repurposed.
 *
 * Env vars (all optional):
 *  - `LETSPLAY_EXPORT_MIX=1`        — gate; without it only the fast smoke test runs
 *  - `LETSPLAY_EXPORT_MIX_SESSIONS_SCALE` — multiplies every stratum's session count
 *    (default `1` = the full Task 9 mix, ~200 sessions)
 *  - `LETSPLAY_EXPORT_MIX_STEPS`    — overrides every stratum's steps uniformly
 *    (default: each stratum's own `steps`, 500 in {@link DEFAULT_SCENARIO_MIX})
 *  - `LETSPLAY_EXPORT_MIX_OUTPUT`   — output JSONL path (default
 *    `tools/ai/dataset/train.jsonl`)
 *  - `LETSPLAY_EXPORT_MIX_SEED_PREFIX` — seed prefix (default `"BC"`)
 *
 * Usage:
 *   npm run dataset:export
 *   LETSPLAY_EXPORT_MIX_SESSIONS_SCALE=0.5 LETSPLAY_EXPORT_MIX_STEPS=200 \
 *     npm run dataset:export   # a faster local/smoke-scale run
 */
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

/** Parse a positive float env var, falling back to `fallback` on absent/NaN/≤0. */
function posFloatEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse a positive-integer env var, falling back to `fallback` on absent/NaN/≤0. */
function posIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** Log a per-action-index row-count histogram — a dead head is a training red flag. */
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

      // Shape guard — never let a malformed row reach the trainer.
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
