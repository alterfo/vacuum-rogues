import { describe, it, expect } from "vitest";
import {
  AnthropicLlmClient,
  FakeLlmClient,
  toAnthropicMessages,
  type LlmRequest,
  type LlmTransport,
} from "./llmClient";
import { judgeTranscript } from "./oddityJudge";
import {
  DEFAULT_VISION_MODEL,
  VISION_ODDITY_RUBRIC,
  buildVisionJudgePrompt,
  detectKnownBugs,
  judgeFrames,
  type OddityFrame,
} from "./visionJudge";
import {
  QUEST_CARD_TEXT_OVERFLOW,
  SHIP_DEATH_NO_EXPLOSION,
  loadVisualBugFixtures,
  type VisualBugFixture,
} from "../../src/tests/fixtures/oddities";

function verdict(
  title: string,
  rationale: string,
  severity = "high",
  evidence: number[] = [0],
): string {
  return JSON.stringify({ findings: [{ title, severity, evidence, rationale }] });
}

describe("VISION_ODDITY_RUBRIC", () => {
  it("enumerates the visual oddity classes the text transcript can't show", () => {
    expect(VISION_ODDITY_RUBRIC).toContain("text-overflow");
    expect(VISION_ODDITY_RUBRIC).toContain("missing-vfx");
    expect(VISION_ODDITY_RUBRIC).toContain("missing-art");
    expect(VISION_ODDITY_RUBRIC).toContain("visual-sameness");
    expect(VISION_ODDITY_RUBRIC).toContain("layout-break");
    expect(VISION_ODDITY_RUBRIC).toMatch(/quest card/i);
    expect(VISION_ODDITY_RUBRIC).toMatch(/explosion/i);
  });
});

describe("buildVisionJudgePrompt", () => {
  it("uses the vision rubric, embeds captions + transcript, and lists the frames", () => {
    const { transcript, frames } = QUEST_CARD_TEXT_OVERFLOW;
    const { system, messages, images } = buildVisionJudgePrompt(transcript, frames);

    expect(system).toBe(VISION_ODDITY_RUBRIC);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("FRAMES:");
    expect(messages[0].content).toContain("[frame 0]");
    expect(messages[0].content).toContain("quest board");
    expect(messages[0].content).toContain("TRANSCRIPT:");
    expect(messages[0].content).toContain('"seed": "FIXTURE-QUEST-OVERFLOW"');

    expect(images).toHaveLength(frames.length);
    expect(images[0].mediaType).toBe("image/png");
    expect(images[0].dataBase64).toBe(frames[0].dataBase64);
  });

  it("defaults a frame's media type to image/png when omitted", () => {
    const frames: OddityFrame[] = [{ dataBase64: "AAAA" }];
    const { images } = buildVisionJudgePrompt(QUEST_CARD_TEXT_OVERFLOW.transcript, frames);
    expect(images[0]).toEqual({ mediaType: "image/png", dataBase64: "AAAA" });
  });
});

describe("detectKnownBugs", () => {
  it("detects a bug when a finding contains every keyword (case-insensitive)", () => {
    const report = {
      findings: [
        {
          title: "Quest card text OVERFLOW",
          severity: "high" as const,
          evidence: [0],
          rationale: "the description spills past the card.",
        },
      ],
      rawText: "",
      malformed: false,
    };
    const [det] = detectKnownBugs(report, [
      { id: "questCardTextOverflow", keywords: ["quest", "overflow"] },
    ]);
    expect(det.detected).toBe(true);
    expect(det.matchedFindings).toHaveLength(1);
  });

  it("does NOT detect when a keyword is missing", () => {
    const report = {
      findings: [
        {
          title: "Some unrelated layout issue",
          severity: "low" as const,
          evidence: [],
          rationale: "panels misaligned",
        },
      ],
      rawText: "",
      malformed: false,
    };
    const [det] = detectKnownBugs(report, [
      { id: "shipDeathNoExplosion", keywords: ["explosion"] },
    ]);
    expect(det.detected).toBe(false);
    expect(det.matchedFindings).toEqual([]);
  });
});

describe("judgeFrames (end-to-end against FakeLlmClient)", () => {
  it("flags the planted visual bug and attaches the frames as images", async () => {
    const { transcript, frames, expected } = QUEST_CARD_TEXT_OVERFLOW;
    const fake = new FakeLlmClient(
      verdict(
        "Quest card text overflow",
        "the quest description text runs past the card's right edge in frame 0.",
        "high",
        [0],
      ),
    );

    const report = await judgeFrames(fake, transcript, frames);

    expect(report.malformed).toBe(false);
    const [det] = detectKnownBugs(report, [expected]);
    expect(det.detected).toBe(true);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].opts?.system).toBe(VISION_ODDITY_RUBRIC);
    expect(fake.calls[0].opts?.model).toBe(DEFAULT_VISION_MODEL);
    expect(fake.calls[0].opts?.images).toHaveLength(frames.length);
    expect(fake.calls[0].opts?.images?.[0].dataBase64).toBe(frames[0].dataBase64);
  });

  it("returns no findings for a clean frame set", async () => {
    const fake = new FakeLlmClient('{"findings": []}');
    const report = await judgeFrames(fake, SHIP_DEATH_NO_EXPLOSION.transcript, SHIP_DEATH_NO_EXPLOSION.frames);
    expect(report.malformed).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("degrades safely when the model returns garbage", async () => {
    const fake = new FakeLlmClient("I see a screenshot but cannot produce JSON");
    const report = await judgeFrames(fake, QUEST_CARD_TEXT_OVERFLOW.transcript, QUEST_CARD_TEXT_OVERFLOW.frames);
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("passes through model/maxTokens overrides", async () => {
    const fake = new FakeLlmClient('{"findings": []}');
    await judgeFrames(fake, SHIP_DEATH_NO_EXPLOSION.transcript, SHIP_DEATH_NO_EXPLOSION.frames, {
      model: "claude-opus-4-8",
      maxTokens: 2048,
    });
    expect(fake.calls[0].opts?.model).toBe("claude-opus-4-8");
    expect(fake.calls[0].opts?.maxTokens).toBe(2048);
  });
});

describe("self-test: the vision judge reproduces each known shipped bug", () => {
  const cannedFor: Record<string, string> = {
    questCardTextOverflow: verdict(
      "Quest card text overflow",
      "the quest card's description overflows its container in the attached frame.",
    ),
    shipDeathNoExplosion: verdict(
      "Missing ship-death explosion",
      "pirate-3 is destroyed per the log, but no explosion VFX appears in the frame.",
    ),
  };

  for (const fixture of loadVisualBugFixtures()) {
    it(`flags "${fixture.title}" (${fixture.id})`, async () => {
      const fake = new FakeLlmClient(cannedFor[fixture.id]);
      const report = await judgeFrames(fake, fixture.transcript, fixture.frames);
      const [det] = detectKnownBugs(report, [fixture.expected]);
      expect(det.detected).toBe(true);
      expect(fake.calls[0].opts?.images).toHaveLength(fixture.frames.length);
    });
  }
});

describe("text-vs-vision asymmetry (the reason the vision path exists)", () => {
  it.each<VisualBugFixture>(loadVisualBugFixtures())(
    "%s: text judge is blind, vision judge catches it",
    async (fixture) => {
      const textFake = new FakeLlmClient('{"findings": []}');
      const textReport = await judgeTranscript(textFake, fixture.transcript);
      expect(textReport.findings).toEqual([]);
      expect(textFake.calls[0].opts?.images).toBeUndefined();

      const visionFake = new FakeLlmClient(
        verdict(fixture.title, `frame evidence for ${fixture.id}: ${fixture.expected.keywords.join(" ")}`),
      );
      const visionReport = await judgeFrames(visionFake, fixture.transcript, fixture.frames);
      const [det] = detectKnownBugs(visionReport, [fixture.expected]);
      expect(det.detected).toBe(true);
      expect(visionFake.calls[0].opts?.images).toHaveLength(fixture.frames.length);
    },
  );
});

describe("toAnthropicMessages (image wire shape)", () => {
  it("returns text-only messages unchanged when there are no images", () => {
    const req: LlmRequest = {
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "hello" }],
    };
    expect(toAnthropicMessages(req)).toBe(req.messages);
  });

  it("folds images into the last user turn as base64 image blocks before its text", () => {
    const req: LlmRequest = {
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "look at this" }],
      images: [{ mediaType: "image/png", dataBase64: "ABC123" }],
    };
    const out = toAnthropicMessages(req) as { role: string; content: unknown }[];
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "ABC123" } },
      { type: "text", text: "look at this" },
    ]);
  });

  it("AnthropicLlmClient threads opts.images into the request for the transport", async () => {
    let captured: LlmRequest | undefined;
    const transport: LlmTransport = async (req) => {
      captured = req;
      return '{"findings": []}';
    };
    const client = new AnthropicLlmClient({ apiKey: "k", transport });
    await client.complete([{ role: "user", content: "judge the frame" }], {
      images: [{ mediaType: "image/png", dataBase64: "ZZZ" }],
    });
    expect(captured?.images).toEqual([{ mediaType: "image/png", dataBase64: "ZZZ" }]);
  });
});
