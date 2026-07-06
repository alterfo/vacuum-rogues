import { describe, it, expect, vi } from "vitest";
import { ACTION_ORDER } from "./observe";
import { FEATURE_LENGTH } from "./NeuralPolicy";
import {
  collectBcDataset,
  collectScenarioMixDataset,
  scaleScenarioMix,
  DEFAULT_SCENARIO_MIX,
  bcDatasetToJsonl,
  type BcRow,
  type ScenarioMixEntry,
} from "./exportBcData";

/**
 * Task 4 of the pure-TS MLP plan: the **behavioural-cloning data-gen** exporter.
 *
 * The exporter runs the teacher policy on the *real* engine and logs
 * `(featurize(obs), actionIndex)` rows — the supervised dataset
 * `tools/ai/train_player.py` fits. These assertions pin the *shape* of that
 * dataset (so a malformed row can never reach the trainer) and its
 * **determinism by seed** (so a training run is reproducible), without training
 * anything: well-formed feature width, every value in [0,1], legal action
 * indices, and identical output for the same seed.
 *
 * Real `GameEngine` / scene wiring — only PixiJS is stubbed (the mock here is what
 * lets the test-free exporter boot the real harness headlessly).
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** Assert one row is well-formed: right width, normalised, legal action index. */
function expectWellFormed(row: BcRow): void {
  expect(row.features).toHaveLength(FEATURE_LENGTH);
  for (const v of row.features) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
  expect(Number.isInteger(row.action)).toBe(true);
  expect(row.action).toBeGreaterThanOrEqual(0);
  expect(row.action).toBeLessThan(ACTION_ORDER.length);
}

describe("collectBcDataset (BC data-gen)", () => {
  it("produces well-formed rows (feature width, [0,1] values, legal action index)", async () => {
    const rows = await collectBcDataset({
      sessions: 1,
      steps: 12,
      seedPrefix: "BC_TEST_SHAPE",
    });
    expect(rows).toHaveLength(12);
    for (const row of rows) expectWellFormed(row);

    // Non-degenerate: the teacher actually played — not every label is "wait".
    const waitIdx = ACTION_ORDER.indexOf("wait");
    const nonWait = rows.filter((r) => r.action !== waitIdx);
    expect(nonWait.length).toBeGreaterThan(0);
  }, 60_000);

  it("is deterministic by seed — same prefix ⇒ identical dataset", async () => {
    const a = await collectBcDataset({
      sessions: 1,
      steps: 8,
      seedPrefix: "BC_TEST_DET",
    });
    const b = await collectBcDataset({
      sessions: 1,
      steps: 8,
      seedPrefix: "BC_TEST_DET",
    });
    expect(a).toEqual(b);
  }, 60_000);

  it("aggregates across K sessions (K×N rows)", async () => {
    const rows = await collectBcDataset({
      sessions: 2,
      steps: 5,
      seedPrefix: "BC_TEST_K",
    });
    expect(rows).toHaveLength(10);
  }, 60_000);
});

describe("scaleScenarioMix (pure mix scaling)", () => {
  it("scales sessions by the factor, rounding and flooring at 1", () => {
    const mix: ScenarioMixEntry[] = [
      { goal: "explorer", sessions: 20, steps: 500 },
      { goal: null, sessions: 3, steps: 500 },
    ];
    const scaled = scaleScenarioMix(mix, { sessionsFactor: 0.1 });
    expect(scaled).toEqual([
      { goal: "explorer", sessions: 2, steps: 500 },
      { goal: null, sessions: 1, steps: 500 }, // 3*0.1=0.3 rounds to 0, floored to 1
    ]);
  });

  it("overrides steps uniformly when given, leaving goal/sessions alone", () => {
    const mix: ScenarioMixEntry[] = [
      { goal: "pirate", sessions: 5, steps: 500 },
    ];
    const scaled = scaleScenarioMix(mix, { steps: 50 });
    expect(scaled).toEqual([{ goal: "pirate", sessions: 5, steps: 50 }]);
  });

  it("defaults to an untouched copy when no options are given", () => {
    expect(scaleScenarioMix(DEFAULT_SCENARIO_MIX)).toEqual(
      DEFAULT_SCENARIO_MIX,
    );
  });
});

describe("collectScenarioMixDataset (stratified CJM mix)", () => {
  it("plays every stratum and concatenates rows in mix order (K sessions × N steps each)", async () => {
    const mix: ScenarioMixEntry[] = [
      { goal: "bounty-hunter", sessions: 1, steps: 4 },
      { goal: null, sessions: 1, steps: 3 },
    ];
    const rows = await collectScenarioMixDataset(mix, "BC_MIX_TEST");
    expect(rows).toHaveLength(7);
    for (const row of rows) expectWellFormed(row);
  }, 60_000);

  it("is deterministic by seed prefix — same prefix ⇒ identical dataset", async () => {
    const mix: ScenarioMixEntry[] = [
      { goal: "explorer", sessions: 1, steps: 4 },
    ];
    const a = await collectScenarioMixDataset(mix, "BC_MIX_DET");
    const b = await collectScenarioMixDataset(mix, "BC_MIX_DET");
    expect(a).toEqual(b);
  }, 60_000);
});

describe("18-action label space (campaign Task 10)", () => {
  it("emits labels over the full 18-action vocabulary, incl. the new arm-up/liberate slots", () => {
    // The exporter labels via `ACTION_ORDER.indexOf(action.kind)` and drops any
    // index < 0. Before Task 10, `arm-up`/`liberate` were OUT of ACTION_ORDER, so
    // the teacher's slayer/arm-up steps were silently dropped from the dataset.
    // Now they are in-vocabulary (indices 16/17), so a teacher that emits them is
    // captured — the schema the trainer fits spans all 18 heads.
    expect(ACTION_ORDER).toHaveLength(18);
    expect(ACTION_ORDER.indexOf("arm-up")).toBe(16);
    expect(ACTION_ORDER.indexOf("liberate")).toBe(17);
  });

  it("a smoke dataset's labels are all in [0,18) with the widened feature width", async () => {
    const rows = await collectBcDataset({
      sessions: 1,
      steps: 10,
      seedPrefix: "BC_TEST_18ACTIONS",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.features).toHaveLength(FEATURE_LENGTH);
      expect(row.action).toBeGreaterThanOrEqual(0);
      expect(row.action).toBeLessThan(18);
    }
  }, 60_000);
});

describe("bcDatasetToJsonl (serialisation)", () => {
  it("emits one parseable JSON object per line, round-tripping the rows", () => {
    const rows: BcRow[] = [
      { features: new Array(FEATURE_LENGTH).fill(0.25), action: 0 },
      { features: new Array(FEATURE_LENGTH).fill(0.5), action: 9 },
    ];
    const jsonl = bcDatasetToJsonl(rows);
    const lines = jsonl.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l) as BcRow)).toEqual(rows);
    expect(jsonl.endsWith("\n")).toBe(true); // POSIX-clean trailing newline
  });

  it("emits an empty string for an empty dataset (no stray newline)", () => {
    expect(bcDatasetToJsonl([])).toBe("");
  });
});
