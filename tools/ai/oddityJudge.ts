/**
 * Offline LLM oddity-judge over session transcripts (dev-only, `tools/`-resident —
 * never in the prod bundle or the pre-push gate).
 *
 * The deterministic oracles (`src/tests/oddities/`) catch closed-form balance /
 * asset / visual problems; this judge catches the open-ended *semantic* oddities
 * they cannot encode — exactly the 2026-06-25 beta classes ("killed a pirate and
 * got nothing", "rep fell with no way back", "quest deadline shorter than the
 * travel time", stuck progression with zero feedback). It feeds a judge-ready
 * {@link SessionTranscript} plus an explicit {@link ODDITY_RUBRIC} to Claude
 * through the injectable {@link LlmClient} and parses the reply into a structured
 * {@link OddityReport}.
 *
 * Three pure pieces (all unit-tested against a fake client, no live API call):
 *  - {@link buildJudgePrompt} — assemble the system rubric + the user message
 *    carrying the serialised transcript;
 *  - {@link parseOddityReport} — turn the model's text reply into an
 *    {@link OddityReport}, **robust to a malformed reply** (degrades to "no
 *    structured findings" + the raw text, never throws);
 *  - {@link judgeTranscript} — the async glue: prompt → `client.complete` → parse.
 *
 * **Dev-only.** Lives under `tools/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import type { LlmClient, LlmMessage } from "./llmClient";
import { DEFAULT_JUDGE_MODEL } from "./llmClient";
import { extractJson } from "./extractJson";
import type { SessionTranscript } from "../../src/tests/playtest/letsplay/transcript";
import { serializeTranscript } from "../../src/tests/playtest/letsplay/transcript";

/** How serious an oddity is — the judge ranks each finding on this scale. */
export type OdditySeverity = "low" | "medium" | "high" | "critical";

/** The known severities, lowest → highest (the parser snaps unknowns to `medium`). */
export const ODDITY_SEVERITIES: readonly OdditySeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/** One judged oddity: what's wrong, how bad, where in the run, and why. */
export interface OddityFinding {
  /** A short human title for the oddity. */
  title: string;
  /** The judged severity (snapped to a known value). */
  severity: OdditySeverity;
  /** Transcript step indices the finding points at (its evidence). */
  evidence: number[];
  /** The judge's free-form reasoning for the call. */
  rationale: string;
}

/** The structured result of judging one transcript. */
export interface OddityReport {
  /** The parsed findings (empty when the reply held none or was malformed). */
  findings: OddityFinding[];
  /** The model's verbatim reply (kept so a malformed reply is never lost). */
  rawText: string;
  /** `true` when the reply could not be parsed into structured findings. */
  malformed: boolean;
}

/**
 * The oddity rubric — the system prompt's core. It enumerates the beta-bug
 * classes the judge looks for and pins the **exact JSON reply shape** the parser
 * expects, so the model returns machine-readable findings.
 */
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

/** Options for {@link judgeTranscript} — model + token cap overrides. */
export interface JudgeOptions {
  /** Override the client's model for this judging call. */
  model?: string;
  /** Hard cap on the model's output tokens. */
  maxTokens?: number;
}

/**
 * Assemble the judge prompt from a transcript: the {@link ODDITY_RUBRIC} as the
 * system message and the serialised transcript as the single user message. Pure.
 */
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

/** Snap an arbitrary value to a known {@link OdditySeverity} (default `medium`). */
function coerceSeverity(value: unknown): OdditySeverity {
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if ((ODDITY_SEVERITIES as readonly string[]).includes(lower)) {
      return lower as OdditySeverity;
    }
  }
  return "medium";
}

/** Coerce a raw `evidence` value to a clean list of integer step indices. */
function coerceEvidence(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

/** Coerce one raw object into an {@link OddityFinding}, or `null` if unusable. */
function coerceFinding(raw: unknown): OddityFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  // A finding with neither a title nor a rationale carries no signal — drop it.
  if (!title && !rationale) return null;
  return {
    title: title || "(untitled oddity)",
    severity: coerceSeverity(obj.severity),
    evidence: coerceEvidence(obj.evidence),
    rationale,
  };
}

/**
 * Parse a model reply into an {@link OddityReport}. **Robust:** a reply that
 * isn't the expected JSON — empty, prose, truncated, the wrong shape — degrades
 * to an empty findings list with `malformed: true` and the raw text preserved.
 * Never throws.
 */
export function parseOddityReport(text: string): OddityReport {
  const rawText = text ?? "";
  const parsed = extractJson(rawText);
  if (parsed === undefined) {
    return { findings: [], rawText, malformed: true };
  }

  // Accept either { findings: [...] } or a bare [...] of findings.
  let rawFindings: unknown;
  if (Array.isArray(parsed)) {
    rawFindings = parsed;
  } else if (parsed && typeof parsed === "object") {
    rawFindings = (parsed as Record<string, unknown>).findings;
  }

  if (!Array.isArray(rawFindings)) {
    // Parsed to JSON but not into a findings list — e.g. {"findings": "none"}.
    // An explicit empty result ({"findings": []}) is handled above (it's an
    // array), so reaching here means the shape was wrong → treat as malformed.
    return { findings: [], rawText, malformed: true };
  }

  const findings = rawFindings
    .map(coerceFinding)
    .filter((f): f is OddityFinding => f !== null);

  return { findings, rawText, malformed: false };
}

/**
 * Judge one session transcript: assemble the prompt, send it through the
 * injected {@link LlmClient}, and parse the reply into an {@link OddityReport}.
 * The client throwing (e.g. the missing-key guard) propagates; a *malformed but
 * returned* reply degrades safely via {@link parseOddityReport}.
 */
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
