import { SceneType } from "@/types";
import {
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";

export const NEWS_FEED_CAP = 100;

export type CampaignOutcome =
  | "win" // Overmind arc reached status "won" (eradicated / core-kill)
  | "loss" // arc reached status "lost" (share held ≥ loss share past grace)
  | "died" // the player died (GAME_OVER) before the arc resolved
  | "timeout"; // neither happened within the day/step budget

export interface CampaignDeathCause {
  killerNpcId: string;
  killerRole: string;
  engagementStartHullFraction: number | null;
  simultaneousCombatants: number;
  roundsSurvived: number;
}

export interface CampaignDaySignal {
  day: number;
  maxHull: number;
  weaponDamage: number;
  overmindSystemCount: number;
  playerLiberations: number;
}

export interface CampaignMilestones {
  battleReadyDay: number | null;
  firstLiberationDay: number | null;
  firstPlayerLiberationDay: number | null;
  peakOvermindCount: number;
  lastOvermindCount: number | null;
}

export function emptyMilestones(): CampaignMilestones {
  return {
    battleReadyDay: null,
    firstLiberationDay: null,
    firstPlayerLiberationDay: null,
    peakOvermindCount: 0,
    lastOvermindCount: null,
  };
}

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
  const firstPlayerLiberationDay =
    m.firstPlayerLiberationDay ?? (s.playerLiberations > 0 ? s.day : null);
  return {
    battleReadyDay,
    firstLiberationDay,
    firstPlayerLiberationDay,
    peakOvermindCount: Math.max(m.peakOvermindCount, s.overmindSystemCount),
    lastOvermindCount: s.overmindSystemCount,
  };
}

export interface CampaignStepSignal {
  day: number;
  scene: SceneType;
  actionKind: string;
  credits: number;
  combatActive: boolean;
  hostileCount: number;
}

export interface CampaignStallStats {
  combatStanceZeroHostileSteps: number;
  maxRepeatActionRun: number;
  worstRepeatKey: string | null;
  maxDayFrozenStreakUndocked: number;
  steps: number;
  _prevKey: string | null;
  _curRepeatRun: number;
  _prevDay: number | null;
  _prevCredits: number | null;
  _curDayFrozenRun: number;
}

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

function isDockedScene(scene: SceneType): boolean {
  return (
    scene === SceneType.STATION ||
    scene === SceneType.PLANET ||
    scene === SceneType.TRADE ||
    scene === SceneType.EQUIPMENT_SHOP ||
    scene === SceneType.BANK
  );
}

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

export interface CampaignMemoryStats {
  priceBookPlanets: number;
  threatMapSystems: number;
  visitedSystems: number;
  inventoryLots: number;
  inventoryLotUnits: number;
  newsFeedLength: number;
  planetCount: number;
  systemCount: number;
  peakCargoCapacity: number;
}

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

export interface CampaignSessionReport {
  index: number;
  seed: string;
  outcome: CampaignOutcome;
  resolutionDay: number | null;
  finalDay: number;
  steps: number;
  stepStalled: boolean;
  calendarWedged: boolean;
  peakPower: number;
  milestones: Pick<
    CampaignMilestones,
    | "battleReadyDay"
    | "firstLiberationDay"
    | "firstPlayerLiberationDay"
    | "peakOvermindCount"
  >;
  died: boolean;
  questsCompleted: number;
  finalCredits: number;
  peakCredits?: number;
  loanBalance: number;
  finalOvermindShare: number;
  errors: number;
  violations: number;
  wallMs: number;
  heapDeltaMB: number;
  memory: CampaignMemoryStats;
  stall?: CampaignStallStats;
  deathCause?: CampaignDeathCause | null;
}

export interface CampaignRunSummary {
  sessions: number;
  wins: number;
  losses: number;
  deaths: number;
  timeouts: number;
  wedged: number;
  winRate: number;
  medianWinDay: number | null;
  battleReadyRate: number;
  avgBattleReadyDay: number | null;
  liberationRate: number;
  avgFirstLiberationDay: number | null;
  playerLiberationRate: number;
  avgFirstPlayerLiberationDay: number | null;
  avgPeakPower: number;
  totalErrors: number;
  totalViolations: number;
  maxWallMs: number;
}

function medianOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function meanOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

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
  const playerLiberations = sessions
    .map((s) => s.milestones.firstPlayerLiberationDay)
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
    playerLiberationRate: n === 0 ? 0 : playerLiberations.length / n,
    avgFirstPlayerLiberationDay: meanOrNull(playerLiberations),
    avgPeakPower:
      n === 0 ? 0 : sessions.reduce((a, s) => a + s.peakPower, 0) / n,
    totalErrors: sessions.reduce((a, s) => a + s.errors, 0),
    totalViolations: sessions.reduce((a, s) => a + s.violations, 0),
    maxWallMs: n === 0 ? 0 : Math.max(...sessions.map((s) => s.wallMs)),
  };
}

function day(v: number | null): string {
  return v == null ? "-" : `d${Math.round(v)}`;
}

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
        `firstLib=${day(s.milestones.firstLiberationDay)} firstSoloLib=${day(s.milestones.firstPlayerLiberationDay)} quests=${s.questsCompleted} credits=${s.finalCredits} ` +
        `peakCredits=${s.peakCredits ?? s.finalCredits} loan=${s.loanBalance} ` +
        `share=${s.finalOvermindShare.toFixed(2)} errors=${s.errors} violations=${s.violations} ` +
        `wall=${(s.wallMs / 1000).toFixed(1)}s heapΔ=${s.heapDeltaMB.toFixed(0)}MB${st}${dc}`,
    );
  }
  lines.push(
    `  milestones: battle-ready ${(sum.battleReadyRate * 100).toFixed(0)}% (avg ${day(sum.avgBattleReadyDay)}), ` +
      `liberation ${(sum.liberationRate * 100).toFixed(0)}% (avg ${day(sum.avgFirstLiberationDay)}), ` +
      `solo-liberation ${(sum.playerLiberationRate * 100).toFixed(0)}% (avg ${day(sum.avgFirstPlayerLiberationDay)}), ` +
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
