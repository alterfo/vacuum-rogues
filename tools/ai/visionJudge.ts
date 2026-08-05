import type { LlmClient, LlmImage, LlmMessage } from "./llmClient";
import { DEEP_PASS_MODEL } from "./llmClient";
import {
  parseOddityReport,
  type OddityFinding,
  type OddityReport,
} from "./oddityJudge";
import type { SessionTranscript } from "../../src/tests/playtest/letsplay/transcript";
import { serializeTranscript } from "../../src/tests/playtest/letsplay/transcript";

export const DEFAULT_VISION_MODEL = DEEP_PASS_MODEL;

export interface OddityFrame {
  dataBase64: string;
  mediaType?: string;
  caption?: string;
  stepIndex?: number;
}

export interface ExpectedVisualBug {
  id: string;
  keywords: string[];
}

export interface BugDetection {
  bug: ExpectedVisualBug;
  detected: boolean;
  matchedFindings: OddityFinding[];
}

export interface VisionJudgeOptions {
  model?: string;
  maxTokens?: number;
}

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
