import type { LlmClient, LlmMessage } from "./llmClient";
import { DEFAULT_JUDGE_MODEL } from "./llmClient";
import { extractJson } from "./extractJson";
import type { SessionTranscript } from "../../src/tests/playtest/letsplay/transcript";
import { serializeTranscript } from "../../src/tests/playtest/letsplay/transcript";

export type OdditySeverity = "low" | "medium" | "high" | "critical";

export const ODDITY_SEVERITIES: readonly OdditySeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export interface OddityFinding {
  title: string;
  severity: OdditySeverity;
  evidence: number[];
  rationale: string;
}

export interface OddityReport {
  findings: OddityFinding[];
  rawText: string;
  malformed: boolean;
}

export const ODDITY_RUBRIC = `You are a meticulous QA judge for a browser space-RPG (a Space Rangers–like trading/combat/quest game). You are given a JSON transcript of one automated play session: a session summary plus one record per step (galaxy day, scene, the action taken, the change in vitals across the step, and any notable log line).

Judge ONLY what the transcript shows. Flag concrete player-facing ODDITIES — moments that would feel absurd, unfair, broken, or like a dead-end to a real player. Look especially for these classes:

- unrewarded-combat: a kill (killPoints went up, or a "destroyed"/combat log) with no reward — credits/cargo did not increase and no loot was collectable.
- rep-dead-end: reputation fell (reputationMin dropped, especially to a deep negative) with no visible path back up — punished with no recovery feedback.
- uncollectable-loot: loot dropped or referenced that the player had no way to pick up.
- quest-unreachable-for-deadline: a quest whose target is many jumps away but whose deadline (days) is too short to reach — impossible on its face.
- stuck-progression: many steps with no meaningful progress — credits flat/declining, no quests completed, no exploration, the agent spinning.
- no-feedback-event: a significant event (death, big loss, faction change) occurred with no player-visible feedback in the logs/vitals.

Do NOT invent problems the transcript does not evidence. A clean, sensibly-progressing session should yield an empty findings list.

Reply with STRICT JSON and nothing else, in exactly this shape:
{
  "findings": [
    {
      "title": "<short title>",
      "severity": "low" | "medium" | "high" | "critical",
      "evidence": [<step index>, ...],
      "rationale": "<one or two sentences tying the finding to the evidence>"
    }
  ]
}
If there are no oddities, reply with {"findings": []}.`;

export interface JudgeOptions {
  model?: string;
  maxTokens?: number;
}

export function buildJudgePrompt(transcript: SessionTranscript): {
  system: string;
  messages: LlmMessage[];
} {
  const json = serializeTranscript(transcript);
  return {
    system: ODDITY_RUBRIC,
    messages: [
      {
        role: "user",
        content: `Judge this play session and report any oddities as JSON.\n\nTRANSCRIPT:\n${json}`,
      },
    ],
  };
}

function coerceSeverity(value: unknown): OdditySeverity {
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if ((ODDITY_SEVERITIES as readonly string[]).includes(lower)) {
      return lower as OdditySeverity;
    }
  }
  return "medium";
}

function coerceEvidence(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

function coerceFinding(raw: unknown): OddityFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  if (!title && !rationale) return null;
  return {
    title: title || "(untitled oddity)",
    severity: coerceSeverity(obj.severity),
    evidence: coerceEvidence(obj.evidence),
    rationale,
  };
}

export function parseOddityReport(text: string): OddityReport {
  const rawText = text ?? "";
  const parsed = extractJson(rawText);
  if (parsed === undefined) {
    return { findings: [], rawText, malformed: true };
  }

  let rawFindings: unknown;
  if (Array.isArray(parsed)) {
    rawFindings = parsed;
  } else if (parsed && typeof parsed === "object") {
    rawFindings = (parsed as Record<string, unknown>).findings;
  }

  if (!Array.isArray(rawFindings)) {
    return { findings: [], rawText, malformed: true };
  }

  const findings = rawFindings
    .map(coerceFinding)
    .filter((f): f is OddityFinding => f !== null);

  return { findings, rawText, malformed: false };
}

export async function judgeTranscript(
  client: LlmClient,
  transcript: SessionTranscript,
  opts: JudgeOptions = {},
): Promise<OddityReport> {
  const { system, messages } = buildJudgePrompt(transcript);
  const reply = await client.complete(messages, {
    system,
    model: opts.model ?? DEFAULT_JUDGE_MODEL,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
  return parseOddityReport(reply);
}
