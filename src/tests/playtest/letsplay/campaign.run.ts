/**
 * Letsplay engine — the long-horizon **campaign** session runner (dev-only).
 *
 * Task 6 of the three-year-campaign plan: the adaptive clock targets wins in
 * year 2–3 (day 540–1080), i.e. ~6000 agent steps — 20× the CI budget the
 * harness had ever run. {@link runCampaignSession} plays ONE seeded session on
 * the real engine until **day ≥ `maxDays` (default 1080), arc resolution
 * (won/lost), or player death**, and reports the campaign telemetry the 99%
 * gate scores: outcome, resolution day, ratcheted peak power, milestone days
 * (battle-ready / first liberation), deaths, faults, wall time, and
 * bounded-memory evidence.
 *
 * Memory discipline (what makes 6000 steps safe where `runLetsplay` is not):
 *  - **no per-step transcript** — `runLetsplay` keeps every {@link AgentStep}
 *    (observation-derived vitals per step), which is fine at 40 steps and
 *    ~megabytes at 6000; here only running counters and latched milestones
 *    survive a step.
 *  - **day-boundary checkpoints** — the invariant sweep + milestone fold run
 *    once per *game day* (~every 5 steps), not per step, so checkpoint work is
 *    bounded by days (≤ `maxDays`), never by steps.
 *  - the agent's belief state is structurally bounded (priceBook ≤ planets,
 *    threatMap/visited ≤ systems, lots ≤ cargo) — captured at session end as
 *    {@link CampaignMemoryStats} and gated by `checkMemoryBounds`.
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
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
  type CampaignMemoryStats,
  type CampaignSessionReport,
  type CampaignStallStats,
} from "./campaignMetrics";

/** Knobs for one campaign session; defaults size the full 3-year clock. */
export interface CampaignSessionOptions {
  /** Galaxy seed — a session is reproducible from it. */
  seed: string;
  /** Day budget: the session stops once the galaxy day reaches this. */
  maxDays?: number;
  /**
   * Hard step ceiling — a pure backstop, NOT the intended stop. The wedge
   * detector ({@link CAMPAIGN_WEDGE_STEP_LIMIT}) catches a frozen calendar
   * long before this; the ceiling only fires on the pathological
   * "day advances steadily but absurdly slowly" shape. A session it stops is
   * reported `stepStalled`.
   */
  maxSteps?: number;
  /** Policy factory; defaults to the campaign teacher, `MemoryHeuristicPolicy`. */
  policy?: () => PlayerPolicy;
  /**
   * Difficulty for the session's new game (default `"NORMAL"` — the mode the
   * 99% win gate scores). The capacity tier passes `"GOD"` to isolate
   * harness capacity from agent competence: GOD floors hull above zero, so
   * the session can only end by arc resolution or the day budget — never a
   * combat death at step ~150 that leaves the ~6000-step envelope unproven.
   */
  gameMode?: GameMode;
}

/** Knobs for a multi-session campaign run. */
export interface CampaignRunOptions {
  sessions?: number;
  seedPrefix?: string;
  maxDays?: number;
  maxSteps?: number;
  policy?: () => PlayerPolicy;
  gameMode?: GameMode;
}

export const CAMPAIGN_MAX_DAYS_DEFAULT = 1080;
/** Backstop steps per day — see {@link CampaignSessionOptions.maxSteps}. */
export const CAMPAIGN_STEPS_PER_DAY_GUARD = 40;
/**
 * The calendar-wedge detector: this many CONSECUTIVE steps without the galaxy
 * day advancing ends the session (`calendarWedged: true`). Healthy play
 * advances a day every ~1–15 steps and every policy anti-stagnation backoff
 * trips within ~12 folds (`MAX_FOLDS_WITHOUT_DAY_ADVANCE`), so 300 day-frozen
 * steps is unambiguously a behavioural soft-lock (measured live: the
 * pre-Task-7 flee↔avoid-danger-back ping-pong freezes day and credits
 * indefinitely — 8000 steps stuck at day 94 on seed CAMPAIGN-0). Cutting it
 * off keeps a wedged session at ~seconds instead of a step-ceiling burn, so
 * 300-session campaign runs stay feasible while Tasks 7–9 burn the wedges
 * down to zero.
 */
export const CAMPAIGN_WEDGE_STEP_LIMIT = 300;

const MB = 1024 * 1024;

/** Terminal arc statuses — the session's natural resolution. */
function arcResolved(status: string): boolean {
  return status === "won" || status === "lost";
}

/** Terminal scenes — win screen or death, whichever the engine landed in. */
function sceneTerminal(scene: SceneType): boolean {
  return scene === SceneType.WIN_SCREEN || scene === SceneType.GAME_OVER;
}

/**
 * Play one campaign session to day budget / arc resolution / death and fold
 * the telemetry. Never throws on a play fault — applier errors land in the
 * harness sink and surface as the `errors` count, exactly like `runLetsplay`.
 */
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

    /**
     * Day-boundary checkpoint: one observe drives both the invariant sweep and
     * the milestone fold (same single-projection rule as `letsplay.run`'s
     * `checkpoint`), so the two never disagree about the state they saw.
     */
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

      // Per-step stall/cycle fold (Task 9 (vi)): read the combat stance directly
      // off the live scene (isActive with an empty combatant set is the phantom
      // stance the user reports live). Cheap scalars only — no re-observe.
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
        break;
      }
      if (day !== lastCheckpointDay) {
        checkpoint();
        lastCheckpointDay = day;
      }
      if (day >= maxDays) break;

      // Calendar-wedge detector — see CAMPAIGN_WEDGE_STEP_LIMIT.
      if (day > lastDaySeen) {
        lastDaySeen = day;
        stepsSinceDayAdvance = 0;
      } else if (++stepsSinceDayAdvance >= CAMPAIGN_WEDGE_STEP_LIMIT) {
        calendarWedged = true;
        break;
      }
    }

    // Final resting checkpoint so the last day's state is always folded/swept.
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
    };
  } finally {
    harness.dispose();
  }
}

/** Play K campaign sessions (seeds `"<prefix>-<i>"`), one report per session. */
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
    // Progress line per session — a 300-session run is hours; silence reads as a hang.
    // eslint-disable-next-line no-console
    console.log(formatCampaignReport(reports.slice(-1)));
  }
  return reports;
}

/**
 * Persist a campaign run's artifacts (gitignored `.letsplay/`, same home as
 * `writeLetsplayReport`): the structured per-session reports as JSON and the
 * formatted summary as text.
 */
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
