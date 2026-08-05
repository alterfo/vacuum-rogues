import { SceneType } from "@/types";
import type { PlayerActionKind } from "./observe";
import type { AgentRunResult, AgentStep, StepVitals } from "./PlayerAgent";

export interface VitalsDelta {
  credits: number;
  hull: number;
  fuel: number;
  cargo: number;
  reputationMin: number;
  killPoints: number;
}

export interface TranscriptAction {
  kind: PlayerActionKind;
  targetId?: string;
  reason?: string;
}

export interface TranscriptStep {
  index: number;
  day: number;
  scene: SceneType;
  action: TranscriptAction;
  vitalsDelta: VitalsDelta;
  notableLogs: string[];
}

export interface SessionSummary {
  steps: number;
  daysElapsed: number;
  endScene: SceneType;
  survived: boolean;
  deaths: number;
  creditsCurve: number[];
  reputationCurve: number[];
  netCredits: number;
  killPointsGained: number;
  questsTaken: number;
  questsCompleted: number;
  totalErrors: number;
}

export interface SessionTranscript {
  seed: string;
  policy?: string;
  summary: SessionSummary;
  steps: TranscriptStep[];
}

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

function flattenAction(step: AgentStep): TranscriptAction {
  const { kind, targetId, reason } = step.action;
  return {
    kind,
    ...(targetId !== undefined ? { targetId } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export function buildTranscript(
  input: BuildTranscriptInput,
): SessionTranscript {
  const { seed, result, policy } = input;
  const raw = result.steps;

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

export function serializeTranscript(transcript: SessionTranscript): string {
  return JSON.stringify(transcript, null, 2);
}
