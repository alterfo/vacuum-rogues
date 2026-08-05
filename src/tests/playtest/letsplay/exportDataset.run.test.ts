import { describe, it, expect, vi } from "vitest";
import {
  collectBcDataset,
  writeBcDataset,
  bcDatasetToJsonl,
} from "./exportBcData";
import { FEATURE_LENGTH } from "./NeuralPolicy";
import { ACTION_ORDER } from "./observe";
import { GoalBiasedPolicy } from "./goalBias";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const GEN_BC = !!process.env.GEN_BC;

const GEN_SESSIONS = Number(process.env.BC_SESSIONS ?? 8);
const GEN_STEPS = Number(process.env.BC_STEPS ?? 200);

describe("BC dataset exporter", () => {
  it("smoke: produces well-formed rows without GEN_BC (always-on fast gate)", async () => {
    const rows = await collectBcDataset({
      sessions: 1,
      steps: 5,
      seedPrefix: "SMOKE",
      policy: () => new MemoryHeuristicPolicy(),
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.features).toHaveLength(FEATURE_LENGTH);
      expect(r.action).toBeGreaterThanOrEqual(0);
      expect(r.action).toBeLessThan(ACTION_ORDER.length);
    }
  }, 30_000);

  it.skipIf(!GEN_BC)(
    "GEN_BC: generate full multi-goal dataset and write to .letsplay/",
    async () => {
      console.log(
        `Generating BC dataset: ${GEN_SESSIONS} sessions/goal × ${GEN_STEPS} steps`,
      );

      const allRows = [
        ...(await collectBcDataset({
          sessions: GEN_SESSIONS,
          steps: GEN_STEPS,
          seedPrefix: "BC_DEFAULT",
          policy: () => new MemoryHeuristicPolicy(),
        })),
        ...(await collectBcDataset({
          sessions: GEN_SESSIONS,
          steps: GEN_STEPS,
          seedPrefix: "BC_EXPLORE",
          policy: () =>
            new GoalBiasedPolicy(new MemoryHeuristicPolicy(), "free-explore"),
        })),
        ...(await collectBcDataset({
          sessions: GEN_SESSIONS,
          steps: GEN_STEPS,
          seedPrefix: "BC_QUEST",
          policy: () =>
            new GoalBiasedPolicy(new MemoryHeuristicPolicy(), "max-rep"),
        })),
        ...(await collectBcDataset({
          sessions: GEN_SESSIONS,
          steps: GEN_STEPS,
          seedPrefix: "BC_HOARD",
          policy: () =>
            new GoalBiasedPolicy(new MemoryHeuristicPolicy(), "hoard"),
        })),
      ];

      const written = writeBcDataset(allRows);
      console.log(`Wrote ${written.rows} rows to ${written.path}`);

      const jsonl = bcDatasetToJsonl(allRows);
      const lines = jsonl.trimEnd().split("\n");
      expect(lines.length).toBe(allRows.length);
      expect(allRows.length).toBeGreaterThan(100);

      const waitIdx = ACTION_ORDER.indexOf("wait");
      const nonWaitCount = allRows.filter((r) => r.action !== waitIdx).length;
      expect(nonWaitCount).toBeGreaterThan(allRows.length * 0.3);

      console.log(`Action distribution:`);
      for (let i = 0; i < ACTION_ORDER.length; i++) {
        const count = allRows.filter((r) => r.action === i).length;
        const pct = ((count / allRows.length) * 100).toFixed(1);
        console.log(`  ${ACTION_ORDER[i].padEnd(12)} ${count} (${pct}%)`);
      }
    },
    600_000, // 10 min timeout for full export
  );
});
