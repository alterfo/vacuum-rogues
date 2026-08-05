import { describe, it, expect, vi } from "vitest";
import {
  runLetsplayCi,
  formatCiResult,
  DEFAULT_CI_THRESHOLDS,
} from "../playtest/letsplay/ci.run";
import { runCampaignSession } from "../playtest/letsplay/campaign.run";
import { formatCampaignReport } from "../playtest/letsplay/campaignMetrics";
import { POWER_INDEX_BATTLE_READY_THRESHOLD } from "@/config/balance";

vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

describe("Task 8 — the needs-based agent reaches competent, explorable, survivable play", () => {
  it("never starves out, never loses the galaxy, explores, and survives a real horizon", async () => {
    const r = await runLetsplayCi({
      sessions: 3,
      steps: 40,
      seedPrefix: "SESSION_ORACLE",
      thresholds: {
        ...DEFAULT_CI_THRESHOLDS,
        minDaysSurvived: 1,
        minAvgDistinctSystemsVisited: 1.5,
      },
    });

    expect(r.run.fuelDeathCount, formatCiResult(r)).toBe(0);
    expect(r.run.totalInvariantViolations, formatCiResult(r)).toBe(0);
    expect(r.run.overmindLossCount, formatCiResult(r)).toBe(0);
    expect(r.run.minDaysSurvived, formatCiResult(r)).toBeGreaterThanOrEqual(1);
    expect(
      r.run.avgDistinctSystemsVisited,
      formatCiResult(r),
    ).toBeGreaterThanOrEqual(1.5);

    expect(r.result.reasons, formatCiResult(r)).toEqual([]);
    expect(r.ok, formatCiResult(r)).toBe(true);
  }, 60_000);
});

describe("Task 7 — campaign milestone proxies on the seeded medium session", () => {
  it("liberation fires by P2 and ratcheted power crosses the battle-ready band", async () => {
    const r = await runCampaignSession({
      seed: "CAMPAIGN-CAPACITY-0",
      maxDays: 200,
      gameMode: "GOD",
    });
    const detail = formatCampaignReport([r]);

    expect(r.errors, detail).toBe(0);
    expect(r.violations, detail).toBe(0);
    expect(r.calendarWedged, detail).toBe(false);
    expect(r.stepStalled, detail).toBe(false);

    expect(r.milestones.firstLiberationDay, detail).not.toBeNull();
    expect(r.milestones.firstLiberationDay!, detail).toBeLessThanOrEqual(190);

    if (r.outcome !== "win") {
      expect(r.peakPower, detail).toBeGreaterThanOrEqual(
        POWER_INDEX_BATTLE_READY_THRESHOLD,
      );
    }
  }, 120_000);
});

describe("Task 8 — strict battle-ready + first-liberation on the seeded medium session", () => {
  it("reaches battle-ready and liberates at least once, with no death", async () => {
    const r = await runCampaignSession({
      seed: "CAMPAIGN-CAPACITY-27",
      maxDays: 200,
      gameMode: "GOD",
    });
    const detail = formatCampaignReport([r]);

    expect(r.milestones.battleReadyDay, detail).not.toBeNull();
    expect(r.milestones.battleReadyDay!, detail).toBeLessThanOrEqual(200);
    expect(r.milestones.firstLiberationDay, detail).not.toBeNull();
    expect(r.died, detail).toBe(false);
    expect(r.errors, detail).toBe(0);
    expect(r.calendarWedged, detail).toBe(false);
  }, 120_000);
});
