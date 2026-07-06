/**
 * The long-horizon **campaign gate** (Task 6, three-year-campaign plan) —
 * opt-in via `LETSPLAY_CAMPAIGN` (`npm run letsplay:campaign` sets it) so the
 * always-on playtest tier stays fast; heavy runs must never enter pre-push.
 *
 * Two tiers:
 *  - **capacity** — ONE seeded session must reach day ≥ `CAMPAIGN_DAYS`
 *    (default 1080) or arc resolution, headless, error-free, inside a
 *    wall-clock budget, with the agent's belief structures still inside their
 *    world-derived bounds and heap growth capped. This is the perf/capacity
 *    proof that ~6000-step sessions are runnable at all.
 *  - **campaign run** — `CAMPAIGN_SESSIONS` full sessions with per-session
 *    telemetry (win/loss/died/timeout, resolution day, peak power,
 *    battle-ready day, first-liberation day), written to `.letsplay/`. This is
 *    the harness Task 9's 50/300-session 99% gate drives via env overrides —
 *    win-rate itself is deliberately NOT gated here (Tasks 7–9 tune it).
 *
 * Env knobs: `CAMPAIGN_SESSIONS` (default 3), `CAMPAIGN_DAYS` (1080),
 * `CAMPAIGN_STEPS` (days × 40 step backstop), `CAMPAIGN_WALL_MS` per-session
 * wall budget (default 480 s).
 */
import { describe, it, expect, vi } from "vitest";
import {
  runCampaign,
  runCampaignSession,
  writeCampaignReport,
  CAMPAIGN_MAX_DAYS_DEFAULT,
  CAMPAIGN_STEPS_PER_DAY_GUARD,
} from "./campaign.run";
import { checkMemoryBounds, formatCampaignReport } from "./campaignMetrics";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const RUN = !!process.env.LETSPLAY_CAMPAIGN;

/**
 * Parse a positive-integer env override, falling back for a missing, zero,
 * negative, or non-numeric value — same guard as `ci.run.test.ts`, so a typo'd
 * `CAMPAIGN_SESSIONS=0` can't silently run nothing and pass vacuously.
 */
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
/**
 * Per-session wall budget. Baseline measured 2026-07-06 (M-series laptop,
 * jsdom + pixi stub): a full 1080-day capacity session ≈ 65 s, ~5000 steps.
 * 480 s ≈ 7× headroom — generous enough for CI-class hardware, tight enough
 * that an O(steps²) regression (which would push hours) still reds the gate.
 */
const WALL_BUDGET_MS = positiveIntEnv(process.env.CAMPAIGN_WALL_MS, 480_000);
/** Heap-growth cap per session — measured ≈ 260 MB; 1 GB flags a runaway leak. */
const HEAP_BUDGET_MB = 1024;

describe.runIf(RUN)("npm run letsplay:campaign — long-horizon gate", () => {
  it(
    `capacity: one seeded session reaches day ${MAX_DAYS} (or arc resolution) error-free within budget`,
    async () => {
      // GOD mode isolates harness CAPACITY from agent competence: hull floors
      // above zero, so the session can only end by arc resolution or the day
      // budget — the two ends the capacity criterion accepts — never a combat
      // death at step ~150 that would leave the ~6000-step envelope unproven.
      // The campaign-run tier below stays NORMAL (honest game telemetry).
      const r = await runCampaignSession({
        seed: "CAMPAIGN-CAPACITY-0",
        maxDays: MAX_DAYS,
        maxSteps: MAX_STEPS,
        gameMode: "GOD",
      });
      // eslint-disable-next-line no-console
      console.log(formatCampaignReport([r]));

      // Headless without error: no harness-sink faults, no corrupt state.
      expect(r.errors, "harness errors during the campaign session").toBe(0);
      expect(r.violations, "invariant violations during the session").toBe(0);
      // The session must be ended by the GAME (resolution/death) or the DAY
      // budget — never by the wedge detector or the step backstop.
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
      // Perf/capacity budgets.
      expect(r.wallMs, `wall-clock ${Math.round(r.wallMs)}ms`).toBeLessThan(
        WALL_BUDGET_MS,
      );
      expect(
        r.heapDeltaMB,
        `heap grew ${r.heapDeltaMB.toFixed(0)}MB`,
      ).toBeLessThan(HEAP_BUDGET_MB);
      // Bounded memory: belief structures stayed within world-derived caps.
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
      });
      const paths = writeCampaignReport(reports);
      // eslint-disable-next-line no-console
      console.log(formatCampaignReport(reports));
      // eslint-disable-next-line no-console
      console.log(`written: ${paths.reportPath}`);

      expect(reports).toHaveLength(SESSIONS);
      // Crashes are never acceptable at any horizon (same hard zero as CI).
      expect(
        reports.reduce((a, r) => a + r.errors, 0),
        formatCampaignReport(reports),
      ).toBe(0);
      // Every session must terminate for a REPORTED reason — game resolution,
      // the day budget, or the wedge detector. A raw step-ceiling burn means
      // the wedge detector itself failed. (Wedge counts are telemetry here —
      // Tasks 7–9 drive them to zero; the win-rate gate lives in Task 9.)
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
