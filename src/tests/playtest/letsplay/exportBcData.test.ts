import { describe, it, expect, vi } from "vitest";
import { ACTION_ORDER } from "./observe";
import { FEATURE_LENGTH } from "./NeuralPolicy";
import { collectBcDataset, bcDatasetToJsonl, type BcRow } from "./exportBcData";

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
