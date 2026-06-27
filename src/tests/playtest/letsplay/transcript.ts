/**
 * Letsplay engine — judge-ready session transcript artifact (dev-only, pure).
 *
 * The fast headless agent plays a session and records a rich {@link AgentRunResult}
 * (per-step day/scene/action/vitals + the harness error sink). This module folds
 * that raw run into a compact, **serialisable** {@link SessionTranscript} an offline
 * LLM judge can read: one line per step ({@link TranscriptStep}: day, scene, action,
 * the *change* in vitals across the step, and any notable log that fired) plus a
 * {@link SessionSummary} (days elapsed, credits/reputation curves, kills, deaths,
 * quests taken/completed). It is the input to the Task-3 oddity judge.
 *
 * **Egocentric + pure.** Every field is derived solely from the agent's own run
 * data + the harness log sink — never from omniscient world state — so the
 * transcript reflects only what the player could perceive, the same honesty
 * {@link observe} enforces. No engine, no I/O: a synthetic {@link AgentRunResult}
 * yields a deterministic transcript, so the builder is unit-testable on fixtures.
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import { SceneType } from "@/types";
import type { PlayerActionKind } from "./observe";
import type { AgentRunResult, AgentStep, StepVitals } from "./PlayerAgent";

/** The change in each scalar vital across one step (`after − before`). */
export interface VitalsDelta {
  credits: number;
  hull: number;
  fuel: number;
  cargo: number;
  reputationMin: number;
  killPoints: number;
}

/** A flattened, judge-readable action record (no live object references). */
export interface TranscriptAction {
  kind: PlayerActionKind;
  /** Optional concrete target the policy aimed at (planet/system/npc id). */
  targetId?: string;
  /** The policy's free-form note for *why* it chose this. */
  reason?: string;
}

/** One step in a {@link SessionTranscript}: what the agent did and what changed. */
export interface TranscriptStep {
  index: number;
  /** Galaxy business day the decision was made on. */
  day: number;
  scene: SceneType;
  action: TranscriptAction;
  /** Change in vitals across this step (zeros when no vitals were captured). */
  vitalsDelta: VitalsDelta;
  /** Harness-sink log lines that fired while applying this step (empty if clean). */
  notableLogs: string[];
}

/** The compact session-level rollup the judge reads before the step detail. */
export interface SessionSummary {
  /** Steps the agent took. */
  steps: number;
  /** Galaxy days elapsed across the session (final day − first day). */
  daysElapsed: number;
  /** The scene the session ended in. */
  endScene: SceneType;
  /** `false` ⇔ the session ended in GAME_OVER (the player died). */
  survived: boolean;
  /** Player deaths this session — 0 or 1 (1 ⇔ ended in GAME_OVER). */
  deaths: number;
  /** Credits at each captured checkpoint (the income/spend trajectory). */
  creditsCurve: number[];
  /** Lowest-faction-standing at each captured checkpoint (the reputation arc). */
  reputationCurve: number[];
  /** Net credits change across the session (last − first). */
  netCredits: number;
  /** Kill points gained across the session (never negative). */
  killPointsGained: number;
  /** Quests the agent accepted (count of `take-quest` actions). */
  questsTaken: number;
  /** Quests completed across the session (final − initial journal count). */
  questsCompleted: number;
  /** Total harness-sink errors recorded over the run (crash/logged-error count). */
  totalErrors: number;
}

/** The full judge-ready artifact for one played session. */
export interface SessionTranscript {
  /** The galaxy seed the session was played on (reproducibility). */
  seed: string;
  /** The policy that played it (e.g. "heuristic"), when known. */
  policy?: string;
  summary: SessionSummary;
  steps: TranscriptStep[];
}

/** Inputs to {@link buildTranscript} — the raw run plus identifying metadata. */
export interface BuildTranscriptInput {
  seed: string;
  result: AgentRunResult;
  policy?: string;
}

const ZERO_DELTA: VitalsDelta = {
  credits: 0,
  hull: 0,
  fuel: 0,
  cargo: 0,
  reputationMin: 0,
  killPoints: 0,
};

/** `after − before` for every scalar vital; the zero delta when either is absent. */
function deltaOf(
  before: StepVitals | undefined,
  after: StepVitals | undefined,
): VitalsDelta {
  if (!before || !after) return { ...ZERO_DELTA };
  return {
    credits: after.credits - before.credits,
    hull: after.hull - before.hull,
    fuel: after.fuel - before.fuel,
    cargo: after.cargoUsed - before.cargoUsed,
    reputationMin: after.reputationMin - before.reputationMin,
    killPoints: after.killPoints - before.killPoints,
  };
}

/** Flatten a recorded {@link AgentStep}'s action to a reference-free record. */
function flattenAction(step: AgentStep): TranscriptAction {
  const { kind, targetId, reason } = step.action;
  return {
    kind,
    ...(targetId !== undefined ? { targetId } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

/**
 * Fold one {@link AgentRunResult} into a serialisable {@link SessionTranscript}.
 * Pure and total: every field comes from the run's own per-step records + final
 * snapshot, so the same run always yields the same transcript (stable JSON). A
 * step's `vitalsDelta` is its before-vitals diffed against the *next* step's
 * before-vitals (or the run's `finalVitals` for the last step); when no vitals
 * were captured the delta is zero and the curves are empty rather than throwing.
 */
export function buildTranscript(
  input: BuildTranscriptInput,
): SessionTranscript {
  const { seed, result, policy } = input;
  const raw = result.steps;

  // The ordered checkpoints: each step's before-vitals, then the resting after.
  const snapshots: StepVitals[] = raw
    .map((s) => s.vitals)
    .filter((v): v is StepVitals => v != null);
  if (result.finalVitals) snapshots.push(result.finalVitals);

  const steps: TranscriptStep[] = raw.map((s, i) => {
    const after = raw[i + 1]?.vitals ?? result.finalVitals;
    return {
      index: s.index,
      day: s.day ?? 0,
      scene: s.scene,
      action: flattenAction(s),
      vitalsDelta: deltaOf(s.vitals, after),
      notableLogs: s.notableLogs ?? [],
    };
  });

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const firstDay = raw[0]?.day ?? 0;
  const finalDay = result.finalDay ?? raw[raw.length - 1]?.day ?? firstDay;

  const survived = result.endScene !== SceneType.GAME_OVER;
  const netCredits = first && last ? last.credits - first.credits : 0;
  const killPointsGained =
    first && last ? Math.max(0, last.killPoints - first.killPoints) : 0;
  const questsCompleted =
    first && last
      ? Math.max(0, last.questsCompleted - first.questsCompleted)
      : 0;
  const questsTaken = raw.filter((s) => s.action.kind === "take-quest").length;

  const summary: SessionSummary = {
    steps: raw.length,
    daysElapsed: Math.max(0, finalDay - firstDay),
    endScene: result.endScene,
    survived,
    deaths: survived ? 0 : 1,
    creditsCurve: snapshots.map((v) => v.credits),
    reputationCurve: snapshots.map((v) => v.reputationMin),
    netCredits,
    killPointsGained,
    questsTaken,
    questsCompleted,
    totalErrors: result.errors.length,
  };

  return {
    seed,
    ...(policy !== undefined ? { policy } : {}),
    summary,
    steps,
  };
}

/**
 * Serialise a {@link SessionTranscript} to a stable JSON string. The builder emits
 * objects with a fixed key order, so this is byte-stable for a given run — the
 * artifact written to disk and fed to the judge.
 */
export function serializeTranscript(transcript: SessionTranscript): string {
  return JSON.stringify(transcript, null, 2);
}
