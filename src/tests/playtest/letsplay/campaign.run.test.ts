import { describe, it, expect, vi } from "vitest";
import {
  runCampaign,
  runCampaignSession,
  writeCampaignReport,
  CAMPAIGN_MAX_DAYS_DEFAULT,
  CAMPAIGN_STEPS_PER_DAY_GUARD,
} from "./campaign.run";
import { checkMemoryBounds, formatCampaignReport } from "./campaignMetrics";
import { NeuralPolicy } from "./NeuralPolicy";
import type { PlayerPolicy } from "./PlayerPolicy";
import playerWeights from "./weights/player.weights.json";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const RUN = !!process.env.LETSPLAY_CAMPAIGN;

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const SESSIONS = positiveIntEnv(process.env.CAMPAIGN_SESSIONS, 3);
const MAX_DAYS = positiveIntEnv(
  process.env.CAMPAIGN_DAYS,
  CAMPAIGN_MAX_DAYS_DEFAULT,
);
const MAX_STEPS = positiveIntEnv(
  process.env.CAMPAIGN_STEPS,
  MAX_DAYS * CAMPAIGN_STEPS_PER_DAY_GUARD,
);
const WALL_BUDGET_MS = positiveIntEnv(process.env.CAMPAIGN_WALL_MS, 480_000);
const HEAP_BUDGET_MB = 1024;

const USE_NEURAL = process.env.CAMPAIGN_POLICY === "neural";
let neuralPolicy: PlayerPolicy | undefined;
async function campaignPolicyFactory(): Promise<
  (() => PlayerPolicy) | undefined
> {
  if (!USE_NEURAL) return undefined;
  if (!neuralPolicy) {
    const p = new NeuralPolicy({ weights: playerWeights });
    await p.load();
    neuralPolicy = p;
  }
  return () => neuralPolicy as PlayerPolicy;
}

describe.runIf(RUN)("npm run letsplay:campaign — long-horizon gate", () => {
  it(
    `capacity: one seeded session reaches day ${MAX_DAYS} (or arc resolution) error-free within budget`,
    async () => {
      const r = await runCampaignSession({
        seed: "CAMPAIGN-CAPACITY-0",
        maxDays: MAX_DAYS,
        maxSteps: MAX_STEPS,
        gameMode: "GOD",
      });
       
      console.log(formatCampaignReport([r]));

      expect(r.errors, "harness errors during the campaign session").toBe(0);
      expect(r.violations, "invariant violations during the session").toBe(0);
      expect(r.calendarWedged, "calendar wedged (day stopped advancing)").toBe(
        false,
      );
      expect(r.stepStalled, "step ceiling hit before the day budget").toBe(
        false,
      );
      expect(
        r.outcome !== "timeout" || r.finalDay >= MAX_DAYS,
        `unresolved session stopped early: outcome=${r.outcome} day=${r.finalDay}`,
      ).toBe(true);
      expect(r.wallMs, `wall-clock ${Math.round(r.wallMs)}ms`).toBeLessThan(
        WALL_BUDGET_MS,
      );
      expect(
        r.heapDeltaMB,
        `heap grew ${r.heapDeltaMB.toFixed(0)}MB`,
      ).toBeLessThan(HEAP_BUDGET_MB);
      expect(checkMemoryBounds(r.memory)).toEqual([]);
    },
    WALL_BUDGET_MS + 120_000,
  );

  it(
    `campaign run: ${SESSIONS} session(s) × ${MAX_DAYS} days with per-session telemetry`,
    async () => {
      const reports = await runCampaign({
        sessions: SESSIONS,
        seedPrefix: "CAMPAIGN",
        maxDays: MAX_DAYS,
        maxSteps: MAX_STEPS,
        policy: await campaignPolicyFactory(),
      });
      const paths = writeCampaignReport(reports);
       
      console.log(formatCampaignReport(reports));
       
      console.log(`written: ${paths.reportPath}`);

      expect(reports).toHaveLength(SESSIONS);
      expect(
        reports.reduce((a, r) => a + r.errors, 0),
        formatCampaignReport(reports),
      ).toBe(0);
      for (const r of reports) {
        expect(
          r.stepStalled,
          `[${r.seed}] step ceiling hit — wedge detector failed`,
        ).toBe(false);
        expect(
          checkMemoryBounds(r.memory),
          `[${r.seed}] memory bounds`,
        ).toEqual([]);
      }
    },
    SESSIONS * (WALL_BUDGET_MS + 60_000),
  );
});
