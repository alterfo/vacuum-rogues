import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactionType, SceneType, type GameMode } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy } from "./PlayerPolicy";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import { questBaselineForObserve } from "./AgentMemory";
import { playerLoanBalance } from "./bankingQueries";
import { checkInvariants } from "./letsplay.run";
import {
  classifyCampaignOutcome,
  emptyMilestones,
  emptyStallStats,
  foldCampaignDay,
  foldCampaignStep,
  formatCampaignReport,
  type CampaignDeathCause,
  type CampaignMemoryStats,
  type CampaignSessionReport,
  type CampaignStallStats,
} from "./campaignMetrics";

export interface CampaignSessionOptions {
  seed: string;
  maxDays?: number;
  maxSteps?: number;
  policy?: () => PlayerPolicy;
  gameMode?: GameMode;
}

export interface CampaignRunOptions {
  sessions?: number;
  seedPrefix?: string;
  maxDays?: number;
  maxSteps?: number;
  policy?: () => PlayerPolicy;
  gameMode?: GameMode;
}

export const CAMPAIGN_MAX_DAYS_DEFAULT = 1080;
export const CAMPAIGN_STEPS_PER_DAY_GUARD = 40;
export const CAMPAIGN_WEDGE_STEP_LIMIT = 300;

const MB = 1024 * 1024;

function arcResolved(status: string): boolean {
  return status === "won" || status === "lost";
}

function sceneTerminal(scene: SceneType): boolean {
  return scene === SceneType.WIN_SCREEN || scene === SceneType.GAME_OVER;
}

export async function runCampaignSession(
  opts: CampaignSessionOptions,
  index = 0,
): Promise<CampaignSessionReport> {
  const maxDays = opts.maxDays ?? CAMPAIGN_MAX_DAYS_DEFAULT;
  const maxSteps = opts.maxSteps ?? maxDays * CAMPAIGN_STEPS_PER_DAY_GUARD;
  const makePolicy = opts.policy ?? (() => new MemoryHeuristicPolicy());

  const heapBefore = process.memoryUsage().heapUsed;
  const wallStart = performance.now();

  const harness = await RealEngineHarness.boot({ seed: opts.seed });
  try {
    await harness.newGame(FactionType.OUTLANDERS, opts.gameMode ?? "NORMAL");
    const engine = harness.engine;
    const agent = new PlayerAgent(harness, makePolicy());

    let milestones = emptyMilestones();
    let stall: CampaignStallStats = emptyStallStats();
    let peakCredits = 0;
    let violations = 0;
    let steps = 0;
    let lastCheckpointDay = -1;
    let peakCargoCapacity = 0;
    let resolutionDay: number | null = null;
    let stepStalled = false;
    let calendarWedged = false;
    let stepsSinceDayAdvance = 0;
    let lastDaySeen = -1;
    let deathCause: CampaignDeathCause | null = null;

    const checkpoint = (): void => {
      const obs = observe(
        engine,
        questBaselineForObserve(agent.belief, engine),
      );
      violations += checkInvariants(obs).length;
      peakCargoCapacity = Math.max(
        peakCargoCapacity,
        obs.player?.cargoCapacity ?? 0,
      );
      milestones = foldCampaignDay(milestones, {
        day: engine.galaxy?.gameDays ?? 0,
        maxHull: obs.player?.maxHull ?? 0,
        weaponDamage: obs.player?.weaponDamage ?? 0,
        overmindSystemCount: engine.galaxy?.overmindSystems.length ?? 0,
        playerLiberations: engine.galaxy?.overmindArc.playerLiberations ?? 0,
      });
    };

    checkpoint(); // the opening state counts (day 0 battle-ready is a bug we'd want to see)
    lastCheckpointDay = engine.galaxy?.gameDays ?? 0;
    lastDaySeen = lastCheckpointDay;

    for (;;) {
      if (steps >= maxSteps) {
        stepStalled = true;
        break;
      }
      const runResult = await agent.run(1);
      steps++;

      const day = engine.galaxy?.gameDays ?? 0;
      const status = engine.galaxy?.overmindArc.status ?? "dormant";
      const scene = engine.currentSceneType;

      const flightScene = harness.currentScene() as {
        combatModule?: { isActive?: boolean; combatants?: { size: number } };
      } | null;
      const lastStep = runResult.steps[runResult.steps.length - 1];
      const creditsNow = engine.player?.credits ?? 0;
      peakCredits = Math.max(peakCredits, creditsNow);
      stall = foldCampaignStep(stall, {
        day,
        scene,
        actionKind: lastStep?.action.kind ?? "wait",
        credits: creditsNow,
        combatActive: flightScene?.combatModule?.isActive === true,
        hostileCount: flightScene?.combatModule?.combatants?.size ?? 0,
      });

      if (arcResolved(status) || sceneTerminal(scene)) {
        resolutionDay = day;
        if (!arcResolved(status) && scene === SceneType.GAME_OVER) {
          deathCause = harness.lastDeathCause();
        }
        break;
      }
      if (day !== lastCheckpointDay) {
        checkpoint();
        lastCheckpointDay = day;
      }
      if (day >= maxDays) break;

      if (day > lastDaySeen) {
        lastDaySeen = day;
        stepsSinceDayAdvance = 0;
      } else if (++stepsSinceDayAdvance >= CAMPAIGN_WEDGE_STEP_LIMIT) {
        calendarWedged = true;
        break;
      }
    }

    checkpoint();

    const finalDay = engine.galaxy?.gameDays ?? 0;
    const endScene = harness.currentSceneType();
    const outcome = classifyCampaignOutcome({
      arcStatus: engine.galaxy?.overmindArc.status ?? "dormant",
      endScene,
    });
    const belief = agent.belief;
    const galaxy = engine.galaxy;
    const memory: CampaignMemoryStats = {
      priceBookPlanets: belief.priceBook.size,
      threatMapSystems: belief.threatMap.size,
      visitedSystems: belief.visitedSystemIds.size,
      inventoryLots: belief.inventoryLots.length,
      inventoryLotUnits: belief.inventoryLots.reduce((a, l) => a + l.qty, 0),
      newsFeedLength: galaxy?.newsFeed.length ?? 0,
      planetCount:
        galaxy?.systems.reduce((a, s) => a + s.planets.length, 0) ?? 0,
      systemCount: galaxy?.systems.length ?? 0,
      peakCargoCapacity,
    };

    return {
      index,
      seed: opts.seed,
      outcome,
      resolutionDay,
      finalDay,
      steps,
      stepStalled,
      calendarWedged,
      peakPower: engine.campaignPeakPower ?? 0,
      milestones: {
        battleReadyDay: milestones.battleReadyDay,
        firstLiberationDay: milestones.firstLiberationDay,
        firstPlayerLiberationDay: milestones.firstPlayerLiberationDay,
        peakOvermindCount: milestones.peakOvermindCount,
      },
      died: outcome === "died",
      questsCompleted: engine.questManager.getCompletedQuestIds().length,
      finalCredits: engine.player?.credits ?? 0,
      peakCredits,
      loanBalance: playerLoanBalance(engine),
      finalOvermindShare:
        galaxy && galaxy.systems.length > 0
          ? galaxy.overmindSystems.length / galaxy.systems.length
          : 0,
      errors: harness.errors().length,
      violations,
      wallMs: performance.now() - wallStart,
      heapDeltaMB: (process.memoryUsage().heapUsed - heapBefore) / MB,
      memory,
      stall,
      deathCause,
    };
  } finally {
    harness.dispose();
  }
}

export async function runCampaign(
  opts: CampaignRunOptions = {},
): Promise<CampaignSessionReport[]> {
  const sessions = opts.sessions ?? 3;
  const seedPrefix = opts.seedPrefix ?? "CAMPAIGN";
  const reports: CampaignSessionReport[] = [];
  for (let i = 0; i < sessions; i++) {
    reports.push(
      await runCampaignSession(
        {
          seed: `${seedPrefix}-${i}`,
          maxDays: opts.maxDays,
          maxSteps: opts.maxSteps,
          policy: opts.policy,
          gameMode: opts.gameMode,
        },
        i,
      ),
    );
     
    console.log(formatCampaignReport(reports.slice(-1)));
  }
  return reports;
}

export function writeCampaignReport(
  reports: readonly CampaignSessionReport[],
  dir = ".letsplay",
): { reportPath: string; summaryPath: string } {
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "campaign-report.json");
  const summaryPath = join(dir, "campaign-summary.txt");
  writeFileSync(reportPath, JSON.stringify(reports, null, 2), "utf8");
  writeFileSync(summaryPath, formatCampaignReport(reports), "utf8");
  return { reportPath, summaryPath };
}
