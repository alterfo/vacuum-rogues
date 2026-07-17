/**
 * Letsplay engine — campaign (long-horizon) metrics, pure core (dev-only).
 *
 * The Task 6 campaign harness plays sessions to **day ≥ 1080 or arc
 * resolution** (~6000 steps — 20× the CI budget), so unlike the short-session
 * oracle it cannot afford to keep a per-step transcript. This module is the
 * pure half of that harness: fold cheap per-day signals into campaign
 * milestones, classify a finished session's outcome, verify the agent's
 * belief-state stayed within its structural bounds, and aggregate/format a
 * multi-session run. No engine, no I/O — everything here is unit-testable on
 * synthetic data (`campaignMetrics.test.ts`).
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import { SceneType } from "@/types";
import {
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";

/**
 * `Galaxy.addNews`'s feed cap, mirrored read-only (the domain keeps its
 * `NEWS_FEED_MAX` private). The campaign bounds check only needs to *detect*
 * the cap failing, not enforce it — same mirror pattern as `sessionMetrics`'s
 * `OVERMIND_LOSS_SHARE`.
 */
export const NEWS_FEED_CAP = 100;

/** How one campaign session ended. */
export type CampaignOutcome =
  | "win" // Overmind arc reached status "won" (eradicated / core-kill)
  | "loss" // arc reached status "lost" (share held ≥ loss share past grace)
  | "died" // the player died (GAME_OVER) before the arc resolved
  | "timeout"; // neither happened within the day/step budget

/**
 * Structured death-cause telemetry (win-rate-100pct plan, Task 6 escalation):
 * what killed the player, read off `CombatModule.lastDeathCause` right after a
 * "died" outcome. Kept as a structural mirror of `CombatModule`'s
 * `PlayerDeathCause` (not imported) — this module stays presentation-free per
 * its own file header. Populated only for `outcome === "died"`; `null`
 * otherwise (a loss/timeout/win has no fatal hit to attribute).
 */
export interface CampaignDeathCause {
  /** The NPC whose shot brought hull to 0. */
  killerNpcId: string;
  killerRole: string;
  /** Player hull / maxHull at the START of the fight that ended in death. */
  engagementStartHullFraction: number | null;
  /** Hostiles simultaneously engaged the instant the fatal hit landed. */
  simultaneousCombatants: number;
  /**
   * Combat rounds started in the fight before the fatal hit (Task 6, second
   * escalation round — the simultaneous-combatant cap measured as a no-op, so
   * this checks engagement DURATION instead of peak concurrency). `1` = died
   * in the opening round.
   */
  roundsSurvived: number;
}

/** One cheap per-day signal the runner samples at each day boundary. */
export interface CampaignDaySignal {
  /** Galaxy business day of this sample. */
  day: number;
  /** Player max hull (loadout-derived) on that day. */
  maxHull: number;
  /** Installed weapon damage on that day. */
  weaponDamage: number;
  /** How many systems the Overmind holds on that day. */
  overmindSystemCount: number;
}

/** The campaign milestones folded from {@link CampaignDaySignal}s. */
export interface CampaignMilestones {
  /**
   * First day the ship cleared BOTH battle-ready thresholds
   * ({@link BATTLE_READY_MAX_HULL} / {@link BATTLE_READY_WEAPON_DAMAGE});
   * `null` if it never did.
   */
  battleReadyDay: number | null;
  /**
   * First day the Overmind's system count *decreased* vs the previous sample —
   * the "player (or the win) liberated a system" proxy; `null` if it never
   * shrank.
   */
  firstLiberationDay: number | null;
  /** The largest Overmind system count ever sampled (pressure peak). */
  peakOvermindCount: number;
  /** Internal: the previous sample's count, for the decrease detection. */
  lastOvermindCount: number | null;
}

/** A fresh, empty milestone fold — call once per session. */
export function emptyMilestones(): CampaignMilestones {
  return {
    battleReadyDay: null,
    firstLiberationDay: null,
    peakOvermindCount: 0,
    lastOvermindCount: null,
  };
}

/**
 * Fold one day-boundary signal into the milestones, returning a **new** value
 * (the input is never mutated — same contract as `updateMemory`). First-day
 * milestones latch (`??=` semantics): once set they never move.
 */
export function foldCampaignDay(
  m: CampaignMilestones,
  s: CampaignDaySignal,
): CampaignMilestones {
  const battleReadyDay =
    m.battleReadyDay ??
    (s.maxHull >= BATTLE_READY_MAX_HULL &&
    s.weaponDamage >= BATTLE_READY_WEAPON_DAMAGE
      ? s.day
      : null);
  const firstLiberationDay =
    m.firstLiberationDay ??
    (m.lastOvermindCount !== null && s.overmindSystemCount < m.lastOvermindCount
      ? s.day
      : null);
  return {
    battleReadyDay,
    firstLiberationDay,
    peakOvermindCount: Math.max(m.peakOvermindCount, s.overmindSystemCount),
    lastOvermindCount: s.overmindSystemCount,
  };
}

/**
 * One cheap per-STEP signal the runner samples after each agent step — the raw
 * input to the stall/cycle detectors (Task 9 (vi)). Unlike {@link
 * CampaignDaySignal} (folded once per game day) this is folded every step, so it
 * carries only scalars the runner reads without a full re-`observe` where it can.
 */
export interface CampaignStepSignal {
  /** Galaxy business day after the step. */
  day: number;
  /** Scene the agent rested in after the step. */
  scene: SceneType;
  /** The action kind the policy chose this step. */
  actionKind: string;
  /** Player credits after the step. */
  credits: number;
  /** Whether in-flight combat was active (the "attack radius drawn" stance). */
  combatActive: boolean;
  /** Hostiles the agent could observe this step. */
  hostileCount: number;
}

/**
 * The autopilot-stupidity signals folded from {@link CampaignStepSignal}s (Task
 * 9 (vi)): the user's primary hypothesis is that the win-rate bottleneck is
 * stalls/cycles, not economy. These surface per-session so a stalling run reads
 * as a stall, not a mystery loss. The `_`-prefixed fields are the running fold
 * state (same pattern as {@link CampaignMilestones.lastOvermindCount}).
 */
export interface CampaignStallStats {
  /**
   * Steps where combat was active (the attack-radius stance) yet ZERO hostiles
   * were observed — the exact "freezes in a combat stance, nothing nearby, just
   * stands" symptom the user reports live. A phantom stance the world-freeze
   * left un-pruned; any nonzero count here is a bug signal.
   */
  combatStanceZeroHostileSteps: number;
  /**
   * Longest run of consecutive steps repeating the SAME (scene, action) with
   * neither the day nor credits changing — a decide→apply cycle making no
   * progress (the classic autopilot "stuck doing the same thing" loop).
   */
  maxRepeatActionRun: number;
  /**
   * The `scene|action` key of the longest repeat-run — NAMES the culprit so a
   * cycle is diagnosable ("which action is it stuck on"), not just counted.
   * `null` before any step is folded.
   */
  worstRepeatKey: string | null;
  /**
   * Longest run of consecutive steps where the galaxy day did NOT advance while
   * the agent was NOT docked/landed — a day-frozen stall outside a legitimate
   * station/planet stay (a productive dock is exempt so a long shopping visit
   * doesn't read as a stall).
   */
  maxDayFrozenStreakUndocked: number;
  /** Total steps folded — the denominator for the counts above. */
  steps: number;
  /** Internal: previous `scene|action` key, for the repeat-run detection. */
  _prevKey: string | null;
  /** Internal: current repeat-run length. */
  _curRepeatRun: number;
  /** Internal: previous step's day, for the "day advanced" comparisons. */
  _prevDay: number | null;
  /** Internal: previous step's credits, for the no-progress comparison. */
  _prevCredits: number | null;
  /** Internal: current undocked day-frozen streak length. */
  _curDayFrozenRun: number;
}

/** A fresh, empty stall fold — call once per session. */
export function emptyStallStats(): CampaignStallStats {
  return {
    combatStanceZeroHostileSteps: 0,
    maxRepeatActionRun: 0,
    worstRepeatKey: null,
    maxDayFrozenStreakUndocked: 0,
    steps: 0,
    _prevKey: null,
    _curRepeatRun: 0,
    _prevDay: null,
    _prevCredits: null,
    _curDayFrozenRun: 0,
  };
}

/** Scenes that count as a legitimate "docked/landed" stay (day-freeze exempt). */
function isDockedScene(scene: SceneType): boolean {
  return (
    scene === SceneType.STATION ||
    scene === SceneType.PLANET ||
    scene === SceneType.TRADE ||
    scene === SceneType.EQUIPMENT_SHOP ||
    scene === SceneType.BANK
  );
}

/**
 * Fold one per-step signal into the stall stats, returning a **new** value (the
 * input is never mutated — same contract as {@link foldCampaignDay}). Detects
 * the three autopilot-stupidity shapes the user called out: a phantom combat
 * stance, a no-progress decide→apply cycle, and an undocked day-frozen streak.
 */
export function foldCampaignStep(
  s: CampaignStallStats,
  sig: CampaignStepSignal,
): CampaignStallStats {
  const combatStanceZeroHostileSteps =
    s.combatStanceZeroHostileSteps +
    (sig.combatActive && sig.hostileCount === 0 ? 1 : 0);

  const dayUnchanged = s._prevDay !== null && sig.day === s._prevDay;
  const creditsUnchanged =
    s._prevCredits !== null && sig.credits === s._prevCredits;

  const key = `${sig.scene}|${sig.actionKind}`;
  const curRepeatRun =
    s._prevKey === key && dayUnchanged && creditsUnchanged
      ? s._curRepeatRun + 1
      : 1;

  const curDayFrozenRun =
    !isDockedScene(sig.scene) && dayUnchanged ? s._curDayFrozenRun + 1 : 0;

  const beatsMax = curRepeatRun > s.maxRepeatActionRun;

  return {
    combatStanceZeroHostileSteps,
    maxRepeatActionRun: Math.max(s.maxRepeatActionRun, curRepeatRun),
    worstRepeatKey: beatsMax ? key : s.worstRepeatKey,
    maxDayFrozenStreakUndocked: Math.max(
      s.maxDayFrozenStreakUndocked,
      curDayFrozenRun,
    ),
    steps: s.steps + 1,
    _prevKey: key,
    _curRepeatRun: curRepeatRun,
    _prevDay: sig.day,
    _prevCredits: sig.credits,
    _curDayFrozenRun: curDayFrozenRun,
  };
}

/**
 * Classify a finished session. Order matters: the arc's own terminal statuses
 * win over the end scene, because the "lost" transition itself shows the
 * defeat screen (GAME_OVER) — reading the scene first would misfile every
 * galaxy-loss as a combat death. A GAME_OVER with a non-terminal arc status is
 * the genuine death. Anything else within budget is a timeout.
 */
export function classifyCampaignOutcome(input: {
  arcStatus: string;
  endScene: SceneType;
}): CampaignOutcome {
  if (input.arcStatus === "won" || input.endScene === SceneType.WIN_SCREEN)
    return "win";
  if (input.arcStatus === "lost") return "loss";
  if (input.endScene === SceneType.GAME_OVER) return "died";
  return "timeout";
}

/**
 * End-of-session sizes of every growable structure the long-horizon session
 * exercises, plus the world-derived bounds they must stay within. Captured by
 * the runner right before disposal.
 */
export interface CampaignMemoryStats {
  /** `AgentMemory.priceBook.size` — planets with remembered prices. */
  priceBookPlanets: number;
  /** `AgentMemory.threatMap.size` — systems with a remembered threat. */
  threatMapSystems: number;
  /** `AgentMemory.visitedSystemIds.size`. */
  visitedSystems: number;
  /** `AgentMemory.inventoryLots.length` (each lot holds ≥ 1 unit). */
  inventoryLots: number;
  /** Total units across all inventory lots (mirrors held cargo). */
  inventoryLotUnits: number;
  /** `galaxy.newsFeed.length` at session end. */
  newsFeedLength: number;
  /** Total planets in the galaxy — the priceBook's hard ceiling. */
  planetCount: number;
  /** Total systems in the galaxy — threatMap/visited hard ceiling. */
  systemCount: number;
  /** The largest cargo capacity sampled this session — the lots' ceiling. */
  peakCargoCapacity: number;
}

/**
 * The structural bounded-memory check: every belief-state structure is keyed
 * by a finite world entity (planet/system) or mirrors held cargo, and the news
 * feed is capped in the domain — so none of them may grow with *steps*. One
 * reason line per breach; empty ⇔ memory stayed bounded. Pure, so the exact
 * gate the capacity test asserts is provable on synthetic stats.
 */
export function checkMemoryBounds(stats: CampaignMemoryStats): string[] {
  const reasons: string[] = [];
  if (stats.priceBookPlanets > stats.planetCount)
    reasons.push(
      `priceBook holds ${stats.priceBookPlanets} planets > ${stats.planetCount} in the galaxy`,
    );
  if (stats.threatMapSystems > stats.systemCount)
    reasons.push(
      `threatMap holds ${stats.threatMapSystems} systems > ${stats.systemCount} in the galaxy`,
    );
  if (stats.visitedSystems > stats.systemCount)
    reasons.push(
      `visitedSystemIds holds ${stats.visitedSystems} systems > ${stats.systemCount} in the galaxy`,
    );
  if (stats.inventoryLotUnits > stats.peakCargoCapacity)
    reasons.push(
      `inventory lots carry ${stats.inventoryLotUnits} units > peak cargo capacity ${stats.peakCargoCapacity}`,
    );
  if (stats.inventoryLots > Math.max(stats.inventoryLotUnits, 0))
    reasons.push(
      `${stats.inventoryLots} inventory lots exceed their ${stats.inventoryLotUnits} total units (empty lots leaked)`,
    );
  if (stats.newsFeedLength > NEWS_FEED_CAP)
    reasons.push(
      `newsFeed length ${stats.newsFeedLength} > domain cap ${NEWS_FEED_CAP}`,
    );
  return reasons;
}

/** The per-session campaign report — what `letsplay:campaign` prints per row. */
export interface CampaignSessionReport {
  index: number;
  seed: string;
  outcome: CampaignOutcome;
  /**
   * The day the arc resolved (win/loss) or the player died; `null` for a
   * timeout (the budget, not the game, ended the session).
   */
  resolutionDay: number | null;
  /** Galaxy day when the session stopped, whatever the reason. */
  finalDay: number;
  /** Agent steps actually taken. */
  steps: number;
  /** `true` ⇔ the step ceiling stopped the session before the day budget. */
  stepStalled: boolean;
  /**
   * `true` ⇔ the runner's wedge detector fired: the calendar stopped advancing
   * for `CAMPAIGN_WEDGE_STEP_LIMIT` consecutive steps (a behavioural soft-lock
   * — e.g. the pre-Task-7 flee↔avoid-danger-back ping-pong), so the session
   * was cut off cheaply instead of burning to the step ceiling. Reported as
   * telemetry, outcome stays "timeout".
   */
  calendarWedged: boolean;
  /** The ratcheted campaign peak power at session end. */
  peakPower: number;
  /** Milestone days (battle-ready / first liberation) — see the fold. */
  milestones: Pick<
    CampaignMilestones,
    "battleReadyDay" | "firstLiberationDay" | "peakOvermindCount"
  >;
  /** `true` ⇔ the player died (outcome "died"). */
  died: boolean;
  /** Quests completed by session end (the economy tier's output metric). */
  questsCompleted: number;
  /** Player credits at session end. */
  finalCredits: number;
  /**
   * Peak credits the player ever banked this session (Task 9 (vii)). The
   * income-vs-price diagnostic for the arming-up path: a peak well above the
   * battle-ready refit cost with `battleReadyDay` still null ⇒ the blocker is
   * PRICE/availability (hull stock/routing), not INCOME. Optional so legacy
   * report literals still type-check; the runner always sets it.
   */
  peakCredits?: number;
  /**
   * Outstanding bank-loan balance at session end — subtract from
   * `finalCredits` for the honest net position (the Task 7 loan-for-repair
   * rescue means raw credits can be borrowed, not earned).
   */
  loanBalance: number;
  /** Overmind galaxy share at session end. */
  finalOvermindShare: number;
  /** Harness-sink errors recorded during the session. */
  errors: number;
  /** Invariant violations (always-actionable / corrupt vitals) recorded. */
  violations: number;
  /** Wall-clock milliseconds the session took. */
  wallMs: number;
  /** `process.memoryUsage().heapUsed` growth across the session, in MB. */
  heapDeltaMB: number;
  /** End-of-session structure sizes + bounds (the bounded-memory evidence). */
  memory: CampaignMemoryStats;
  /**
   * Autopilot stall/cycle detectors (Task 9 (vi)) — optional so legacy report
   * literals (unit-test fixtures) still type-check; the runner always sets it.
   */
  stall?: CampaignStallStats;
  /**
   * Structured death-cause telemetry (Task 6 escalation) — see
   * {@link CampaignDeathCause}. Optional so legacy report literals still
   * type-check; the runner sets it (possibly `null`) whenever `outcome ===
   * "died"`, absent for every other outcome.
   */
  deathCause?: CampaignDeathCause | null;
}

/** Cross-session aggregate for a campaign run. */
export interface CampaignRunSummary {
  sessions: number;
  wins: number;
  losses: number;
  deaths: number;
  timeouts: number;
  /** Sessions cut off by the calendar-wedge detector (a subset of timeouts). */
  wedged: number;
  /** Wins / sessions, in `[0, 1]` (0 for an empty run). */
  winRate: number;
  /** Median resolution day across the *wins*; `null` when there are none. */
  medianWinDay: number | null;
  /** Fraction of sessions that reached battle-ready. */
  battleReadyRate: number;
  /** Mean battle-ready day over sessions that reached it; `null` if none. */
  avgBattleReadyDay: number | null;
  /** Fraction of sessions with a first liberation. */
  liberationRate: number;
  /** Mean first-liberation day over sessions that had one; `null` if none. */
  avgFirstLiberationDay: number | null;
  /** Mean end-of-session ratcheted peak power. */
  avgPeakPower: number;
  totalErrors: number;
  totalViolations: number;
  /** The slowest session's wall-clock ms. */
  maxWallMs: number;
}

/** Median of a list, or `null` when empty. */
function medianOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean of a list, or `null` when empty (so "no data" ≠ "zero"). */
function meanOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Roll per-session campaign reports into the run summary. Pure. */
export function aggregateCampaign(
  sessions: readonly CampaignSessionReport[],
): CampaignRunSummary {
  const n = sessions.length;
  const wins = sessions.filter((s) => s.outcome === "win");
  const count = (o: CampaignOutcome) =>
    sessions.filter((s) => s.outcome === o).length;
  const battleReady = sessions
    .map((s) => s.milestones.battleReadyDay)
    .filter((d): d is number => d != null);
  const liberations = sessions
    .map((s) => s.milestones.firstLiberationDay)
    .filter((d): d is number => d != null);
  return {
    sessions: n,
    wins: wins.length,
    losses: count("loss"),
    deaths: count("died"),
    timeouts: count("timeout"),
    wedged: sessions.filter((s) => s.calendarWedged).length,
    winRate: n === 0 ? 0 : wins.length / n,
    medianWinDay: medianOrNull(
      wins.map((s) => s.resolutionDay).filter((d): d is number => d != null),
    ),
    battleReadyRate: n === 0 ? 0 : battleReady.length / n,
    avgBattleReadyDay: meanOrNull(battleReady),
    liberationRate: n === 0 ? 0 : liberations.length / n,
    avgFirstLiberationDay: meanOrNull(liberations),
    avgPeakPower:
      n === 0 ? 0 : sessions.reduce((a, s) => a + s.peakPower, 0) / n,
    totalErrors: sessions.reduce((a, s) => a + s.errors, 0),
    totalViolations: sessions.reduce((a, s) => a + s.violations, 0),
    maxWallMs: n === 0 ? 0 : Math.max(...sessions.map((s) => s.wallMs)),
  };
}

/** A day value rendered for the report, or `-` when the milestone never fired. */
function day(v: number | null): string {
  return v == null ? "-" : `d${Math.round(v)}`;
}

/**
 * Render a campaign run as a human-readable report: one row per session
 * (outcome, resolution day, peak power, milestone days, faults, wall time)
 * and an aggregate footer. Pure string-building.
 */
export function formatCampaignReport(
  sessions: readonly CampaignSessionReport[],
): string {
  const sum = aggregateCampaign(sessions);
  const lines: string[] = [
    `Letsplay campaign — ${sum.sessions} session(s): ` +
      `${sum.wins} win / ${sum.losses} loss / ${sum.deaths} died / ${sum.timeouts} timeout ` +
      `(${sum.wedged} wedged, win-rate ${(sum.winRate * 100).toFixed(1)}%)`,
  ];
  for (const s of sessions) {
    const stall = s.calendarWedged
      ? " (WEDGED)"
      : s.stepStalled
        ? " (STEP-STALLED)"
        : "";
    const st = s.stall
      ? ` stall[phantom=${s.stall.combatStanceZeroHostileSteps} ` +
        `repeat=${s.stall.maxRepeatActionRun}` +
        (s.stall.maxRepeatActionRun > 1 && s.stall.worstRepeatKey
          ? `@${s.stall.worstRepeatKey}`
          : "") +
        ` dayFrozen=${s.stall.maxDayFrozenStreakUndocked}]`
      : "";
    const dc = s.deathCause
      ? ` death[killer=${s.deathCause.killerRole}#${s.deathCause.killerNpcId} ` +
        `hull@engage=${s.deathCause.engagementStartHullFraction == null ? "-" : s.deathCause.engagementStartHullFraction.toFixed(2)} ` +
        `vs=${s.deathCause.simultaneousCombatants} rounds=${s.deathCause.roundsSurvived}]`
      : "";
    lines.push(
      `  [${s.seed}] ${s.outcome.toUpperCase().padEnd(7)} ` +
        `resolved=${day(s.resolutionDay)} end=${day(s.finalDay)} steps=${s.steps}${stall} ` +
        `power=${s.peakPower.toFixed(2)} battleReady=${day(s.milestones.battleReadyDay)} ` +
        `firstLib=${day(s.milestones.firstLiberationDay)} quests=${s.questsCompleted} credits=${s.finalCredits} ` +
        `peakCredits=${s.peakCredits ?? s.finalCredits} loan=${s.loanBalance} ` +
        `share=${s.finalOvermindShare.toFixed(2)} errors=${s.errors} violations=${s.violations} ` +
        `wall=${(s.wallMs / 1000).toFixed(1)}s heapΔ=${s.heapDeltaMB.toFixed(0)}MB${st}${dc}`,
    );
  }
  lines.push(
    `  milestones: battle-ready ${(sum.battleReadyRate * 100).toFixed(0)}% (avg ${day(sum.avgBattleReadyDay)}), ` +
      `liberation ${(sum.liberationRate * 100).toFixed(0)}% (avg ${day(sum.avgFirstLiberationDay)}), ` +
      `median win ${day(sum.medianWinDay)}, avg peak power ${sum.avgPeakPower.toFixed(2)}`,
    `  faults: errors=${sum.totalErrors} violations=${sum.totalViolations} slowest=${(sum.maxWallMs / 1000).toFixed(1)}s`,
  );
  const withStall = sessions.filter((s) => s.stall);
  if (withStall.length > 0) {
    const phantomSessions = withStall.filter(
      (s) => (s.stall?.combatStanceZeroHostileSteps ?? 0) > 0,
    ).length;
    const worstRepeatSession = withStall.reduce((a, b) =>
      (b.stall?.maxRepeatActionRun ?? 0) > (a.stall?.maxRepeatActionRun ?? 0)
        ? b
        : a,
    );
    const worstRepeat = worstRepeatSession.stall?.maxRepeatActionRun ?? 0;
    const worstRepeatKey = worstRepeatSession.stall?.worstRepeatKey ?? "-";
    const worstDayFrozen = Math.max(
      ...withStall.map((s) => s.stall?.maxDayFrozenStreakUndocked ?? 0),
    );
    lines.push(
      `  stalls: phantom-stance sessions=${phantomSessions}/${withStall.length}, ` +
        `worst repeat-run=${worstRepeat}${worstRepeat > 1 ? `@${worstRepeatKey}` : ""}, ` +
        `worst undocked day-frozen streak=${worstDayFrozen}`,
    );
  }
  const deathCauses = sessions
    .map((s) => s.deathCause)
    .filter((d): d is CampaignDeathCause => !!d);
  if (deathCauses.length > 0) {
    const roleCounts = new Map<string, number>();
    for (const d of deathCauses) {
      roleCounts.set(d.killerRole, (roleCounts.get(d.killerRole) ?? 0) + 1);
    }
    const roleBreakdown = [...roleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${role}=${n}`)
      .join(" ");
    const medianHullAtEngage = medianOrNull(
      deathCauses
        .map((d) => d.engagementStartHullFraction)
        .filter((h): h is number => h != null),
    );
    const medianSimultaneous = medianOrNull(
      deathCauses.map((d) => d.simultaneousCombatants),
    );
    const medianRounds = medianOrNull(deathCauses.map((d) => d.roundsSurvived));
    lines.push(
      `  death causes (${deathCauses.length}/${sessions.length}): killer roles [${roleBreakdown}], ` +
        `median hull@engage=${medianHullAtEngage == null ? "-" : medianHullAtEngage.toFixed(2)}, ` +
        `median simultaneous combatants=${medianSimultaneous ?? "-"}, ` +
        `median rounds survived=${medianRounds ?? "-"}`,
    );
  }
  return lines.join("\n");
}
