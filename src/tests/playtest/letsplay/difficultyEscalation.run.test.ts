import { describe, it, expect, vi } from "vitest";
import { runCampaign } from "./campaign.run";
import { formatCampaignReport } from "./campaignMetrics";
import { playerPowerIndex } from "@/systems/campaign/playerPower";
import { adaptiveSpreadIntervalDays } from "@/systems/campaign/adaptivePacing";
import {
  hostileScaling,
  overmindGarrisonPowerBonus,
} from "@/systems/campaign/hostileScaling";
import {
  POWER_INDEX_HULL_MIN,
  POWER_INDEX_WEAPON_MIN,
  POWER_INDEX_CREDITS_MIN,
  ADAPTIVE_GRACE_DAYS,
} from "@/config/balance";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const RUN = !!process.env.LETSPLAY_CAMPAIGN;

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const SESSIONS = positiveIntEnv(process.env.ESCALATION_SESSIONS, 30);

const STARTER_POWER = playerPowerIndex({
  maxHull: POWER_INDEX_HULL_MIN,
  weaponDamage: POWER_INDEX_WEAPON_MIN,
  credits: POWER_INDEX_CREDITS_MIN,
  rank: 1,
});

describe.runIf(RUN)(
  "difficulty escalation — verified from real campaign telemetry (Task 19)",
  () => {
    it(
      `winning sessions among ${SESSIONS} real campaign runs show late-game pressure ` +
        "≥ early-game pressure (spread cadence, hostile/neutral scaling, garrison bonus)",
      async () => {
        const reports = await runCampaign({
          sessions: SESSIONS,
          seedPrefix: "ESCALATION",
        });
         
        console.log(formatCampaignReport(reports));

        const wins = reports.filter((r) => r.outcome === "win");
        expect(
          wins.length,
          `0 wins among ${SESSIONS} sessions — cannot verify escalation ` +
            `"within winning runs"; the Task-9-documented plateau makes this ` +
            "possible but unlikely at this sample size; re-run with a larger " +
            "ESCALATION_SESSIONS if it recurs.\n" +
            formatCampaignReport(reports),
        ).toBeGreaterThan(0);

        for (const r of wins) {
          const earlyInterval = adaptiveSpreadIntervalDays(
            ADAPTIVE_GRACE_DAYS,
            0,
            STARTER_POWER,
          );
          const lateDay = r.resolutionDay ?? r.finalDay;
          const lateInterval = adaptiveSpreadIntervalDays(
            lateDay,
            0,
            r.peakPower,
          );
          expect(
            lateInterval,
            `[${r.seed}] late-game spread interval (day ${lateDay}, ` +
              `peakPower ${r.peakPower.toFixed(2)}) must be ≤ the early-game ` +
              `interval (day ${ADAPTIVE_GRACE_DAYS}, starter power ` +
              `${STARTER_POWER.toFixed(3)})`,
          ).toBeLessThanOrEqual(earlyInterval);

          const earlyHostile = hostileScaling(STARTER_POWER, "NORMAL");
          const lateHostile = hostileScaling(r.peakPower, "NORMAL");
          expect(
            lateHostile.damageMult,
            `[${r.seed}] late-game hostile incoming-damage mult must be ≥ early-game`,
          ).toBeGreaterThanOrEqual(earlyHostile.damageMult);
          expect(
            lateHostile.hpMult,
            `[${r.seed}] late-game hostile HP mult (effective enemy toughness) must be ≥ early-game`,
          ).toBeGreaterThanOrEqual(earlyHostile.hpMult);

          const earlyGarrisonBonus = overmindGarrisonPowerBonus(STARTER_POWER);
          const lateGarrisonBonus = overmindGarrisonPowerBonus(r.peakPower);
          expect(
            lateGarrisonBonus,
            `[${r.seed}] late-game garrison power bonus must be ≥ early-game`,
          ).toBeGreaterThanOrEqual(earlyGarrisonBonus);
        }
      },
      SESSIONS * 60_000,
    );
  },
);
