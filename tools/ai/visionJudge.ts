/**
 * Offline LLM **vision** oddity-judge over captured frames + a transcript
 * (dev-only, `tools/`-resident — never in the prod bundle or the pre-push gate).
 *
 * The text judge ({@link judgeTranscript} in `oddityJudge.ts`) reads only the
 * serialised {@link SessionTranscript}, so it is structurally blind to anything
 * the transcript cannot encode — UI text overflowing its card, a ship destroyed
 * with no explosion sprite, a missing texture rendering as a blank rectangle,
 * every sun drawn the same colour. Those are **visual** oddities. This judge adds
 * the one thing the text judge lacks: it attaches the captured **frames** as
 * Claude vision images (through the same {@link LlmClient} seam, via
 * {@link LlmCompleteOptions.images}) alongside the transcript, with a
 * vision-specific rubric, and parses the reply into the **same**
 * {@link OddityReport} the text judge produces (reusing {@link parseOddityReport},
 * so the malformed-reply robustness is shared).
 *
 * Three pure pieces (all unit-tested against a {@link FakeLlmClient}, no live call):
 *  - {@link buildVisionJudgePrompt} — assemble the vision rubric + a user message
 *    carrying the frame captions and the serialised transcript, plus the image list;
 *  - {@link detectKnownBugs} — given an {@link OddityReport} and a list of
 *    {@link ExpectedVisualBug}s, report which expected bugs the judge actually
 *    flagged (the self-test oracle: a planted pre-fix bug must be detected);
 *  - {@link judgeFrames} — the async glue: prompt → `client.complete({images})`
 *    → {@link parseOddityReport}.
 *
 * The **live vision call runs only in the offline runner** (a real key, a real
 * model). Tests inject a {@link FakeLlmClient} returning a canned vision verdict,
 * so the validation logic is deterministic and free.
 *
 * **Dev-only.** Lives under `tools/`, imported by no production module (enforced
 * by `letsplayDevOnly.test.ts`'s `tools/ai` prod-graph guard).
 */
import type { LlmClient, LlmImage, LlmMessage } from "./llmClient";
import { DEEP_PASS_MODEL } from "./llmClient";
import {
  parseOddityReport,
  type OddityFinding,
  type OddityReport,
} from "./oddityJudge";
import type { SessionTranscript } from "../../src/tests/playtest/letsplay/transcript";
import { serializeTranscript } from "../../src/tests/playtest/letsplay/transcript";

/**
 * Default vision model — a capable model for the periodic deep pass (Opus). The
 * vision judge is the slow, paid, manual sweep, not the high-volume text gate, so
 * it defaults to {@link DEEP_PASS_MODEL} rather than the cheaper judging model.
 */
export const DEFAULT_VISION_MODEL = DEEP_PASS_MODEL;

/** One captured frame fed to the vision judge. */
export interface OddityFrame {
  /** Base64-encoded image bytes (no `data:` prefix, no newlines). */
  dataBase64: string;
  /** The image MIME type (defaults to `"image/png"`). */
  mediaType?: string;
  /** A human caption tying the frame to the run (rendered into the prompt). */
  caption?: string;
  /** The transcript step index this frame was captured at, when known. */
  stepIndex?: number;
}

/**
 * A bug the vision judge is expected to flag for a given fixture — the self-test
 * oracle. A finding counts as detecting the bug when its title+rationale (case-
 * insensitively) contains **every** keyword in {@link keywords}.
 */
export interface ExpectedVisualBug {
  /** Stable id for the bug (matches the fixture id). */
  id: string;
  /** All keywords that a flagging finding must mention (AND-matched, lowercased). */
  keywords: string[];
}

/** Whether a single {@link ExpectedVisualBug} was detected, and by which findings. */
export interface BugDetection {
  bug: ExpectedVisualBug;
  /** `true` ⇔ at least one finding matched every keyword. */
  detected: boolean;
  /** The findings that matched (empty when not detected). */
  matchedFindings: OddityFinding[];
}

/** Options for {@link judgeFrames} — model + token cap overrides. */
export interface VisionJudgeOptions {
  /** Override the vision model for this call (defaults to {@link DEFAULT_VISION_MODEL}). */
  model?: string;
  /** Hard cap on the model's output tokens. */
  maxTokens?: number;
}

/**
 * The vision rubric — the system prompt's core. It enumerates the **visual**
 * oddity classes the text transcript cannot show (the two self-test bugs are
 * first-class members: quest-card text overflow and a missing ship-death
 * explosion), keeps the semantic classes for cross-referencing, and pins the
 * **exact JSON reply shape** {@link parseOddityReport} expects.
 */
export const VISION_ODDITY_RUBRIC = `You are a meticulous VISUAL QA judge for a browser space-RPG (a Space Rangers–like trading/combat/quest game). You are given, in order, one or more captured SCREENSHOTS (frames) of an automated play session, each captioned, plus a JSON transcript of that session (galaxy day, scene, action, vitals change, notable log per step).

Judge what the FRAMES show, cross-referenced with the transcript. Flag concrete player-facing VISUAL ODDITIES — things that look broken, unfinished, or wrong on screen and that a text-only log could never reveal. Look especially for these classes:

- text-overflow: UI text spilling outside its container — a quest card / panel / button / tooltip whose text runs past its bounds, is clipped, or overlaps neighbouring elements.
- missing-vfx: an event that should have a visual effect but shows none — e.g. a ship is destroyed in the transcript/log but the frame shows no explosion or death effect.
- missing-art: a sprite/texture that failed to load — a blank, solid, or placeholder rectangle where a planet/ship/star/icon should be.
- visual-sameness: many entities rendered identically when they should vary — e.g. every star the same colour, every planet the same texture.
- layout-break: overlapping, clipped, off-screen, or misaligned UI elements.
- no-feedback-event: a significant event (death, big loss) with no visible on-screen feedback at all.

Judge ONLY what the frames and transcript evidence. Do NOT invent problems. A clean, correctly-rendered session should yield an empty findings list.

Reply with STRICT JSON and nothing else, in exactly this shape:
{
  "findings": [
    {
      "title": "<short title>",
      "severity": "low" | "medium" | "high" | "critical",
      "evidence": [<frame or step index>, ...],
      "rationale": "<one or two sentences tying the finding to a specific frame>"
    }
  ]
}
If there are no visual oddities, reply with {"findings": []}.`;

/**
 * Assemble the vision judge prompt: the {@link VISION_ODDITY_RUBRIC} as the system
 * message, a single user message carrying the per-frame captions and the
 * serialised transcript, and the image list (one {@link LlmImage} per frame, in
 * order). Pure — no client, no I/O.
 */
export function buildVisionJudgePrompt(
  transcript: SessionTranscript,
  frames: OddityFrame[],
): { system: string; messages: LlmMessage[]; images: LlmImage[] } {
  const images: LlmImage[] = frames.map((f) => ({
    mediaType: f.mediaType ?? "image/png",
    dataBase64: f.dataBase64,
  }));
  const captions = frames
    .map((f, i) => {
      const where =
        f.caption ??
        (f.stepIndex !== undefined ? `step ${f.stepIndex}` : "(no caption)");
      return `[frame ${i}] ${where}`;
    })
    .join("\n");
  const json = serializeTranscript(transcript);
  const messages: LlmMessage[] = [
    {
      role: "user",
      content:
        `Judge this play session for VISUAL oddities. ${frames.length} frame(s) ` +
        `are attached in order; each is captioned below. Cross-reference the ` +
        `frames with the transcript and report any oddities as JSON.\n\n` +
        `FRAMES:\n${captions || "(none)"}\n\nTRANSCRIPT:\n${json}`,
    },
  ];
  return { system: VISION_ODDITY_RUBRIC, messages, images };
}

/**
 * Given a parsed {@link OddityReport} and the bugs we expect a fixture to surface,
 * report which were actually flagged. A finding matches a bug when its title +
 * rationale (lowercased) contains **every** keyword of the bug. Pure. This is the
 * self-test oracle: a pre-fix fixture must yield `detected: true` for its bug.
 */
export function detectKnownBugs(
  report: OddityReport,
  expected: ExpectedVisualBug[],
): BugDetection[] {
  return expected.map((bug) => {
    const keywords = bug.keywords.map((k) => k.toLowerCase());
    const matchedFindings = report.findings.filter((f) => {
      const hay = `${f.title} ${f.rationale}`.toLowerCase();
      return keywords.every((kw) => hay.includes(kw));
    });
    return { bug, detected: matchedFindings.length > 0, matchedFindings };
  });
}

/**
 * Judge captured frames + a transcript for visual oddities: assemble the prompt,
 * send it through the injected {@link LlmClient} **with the frames attached as
 * images**, and parse the reply into an {@link OddityReport}. The client throwing
 * (e.g. the missing-key guard) propagates; a *malformed but returned* reply
 * degrades safely via {@link parseOddityReport}.
 */
export async function judgeFrames(
  client: LlmClient,
  transcript: SessionTranscript,
  frames: OddityFrame[],
  opts: VisionJudgeOptions = {},
): Promise<OddityReport> {
  const { system, messages, images } = buildVisionJudgePrompt(transcript, frames);
  const reply = await client.complete(messages, {
    system,
    model: opts.model ?? DEFAULT_VISION_MODEL,
    images,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
  return parseOddityReport(reply);
}
