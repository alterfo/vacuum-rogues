import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import { FakeLlmClient } from "./llmClient";
import {
  ODDITY_RUBRIC,
  buildJudgePrompt,
  parseOddityReport,
  judgeTranscript,
} from "./oddityJudge";
import type {
  SessionTranscript,
  SessionSummary,
  TranscriptStep,
} from "../../src/tests/playtest/letsplay/transcript";

function mkTranscript(over: Partial<SessionTranscript> = {}): SessionTranscript {
  const summary: SessionSummary = {
    steps: 1,
    daysElapsed: 0,
    endScene: SceneType.SPACE_FLIGHT,
    survived: true,
    deaths: 0,
    creditsCurve: [1000],
    reputationCurve: [0],
    netCredits: 0,
    killPointsGained: 0,
    questsTaken: 0,
    questsCompleted: 0,
    totalErrors: 0,
    ...(over.summary ?? {}),
  };
  const steps: TranscriptStep[] = over.steps ?? [
    {
      index: 0,
      day: 0,
      scene: SceneType.SPACE_FLIGHT,
      action: { kind: "move" },
      vitalsDelta: {
        credits: 0,
        hull: 0,
        fuel: 0,
        cargo: 0,
        reputationMin: 0,
        killPoints: 0,
      },
      notableLogs: [],
    },
  ];
  return { seed: "SEED", policy: "heuristic", ...over, summary, steps };
}

describe("buildJudgePrompt", () => {
  it("uses the rubric as the system prompt and embeds the serialised transcript", () => {
    const transcript = mkTranscript({ seed: "ABC" });
    const { system, messages } = buildJudgePrompt(transcript);

    expect(system).toBe(ODDITY_RUBRIC);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain('"seed": "ABC"');
    expect(messages[0].content).toContain("TRANSCRIPT:");
  });

  it("rubric enumerates the beta oddity classes the judge looks for", () => {
    expect(ODDITY_RUBRIC).toContain("unrewarded-combat");
    expect(ODDITY_RUBRIC).toContain("rep-dead-end");
    expect(ODDITY_RUBRIC).toContain("uncollectable-loot");
    expect(ODDITY_RUBRIC).toContain("quest-unreachable-for-deadline");
    expect(ODDITY_RUBRIC).toContain("stuck-progression");
    expect(ODDITY_RUBRIC).toContain("no-feedback-event");
  });
});

describe("parseOddityReport", () => {
  it("parses a well-formed findings list with all fields", () => {
    const reply = JSON.stringify({
      findings: [
        {
          title: "Unrewarded kill",
          severity: "high",
          evidence: [3, 4],
          rationale: "killPoints rose but credits did not change.",
        },
      ],
    });
    const report = parseOddityReport(reply);

    expect(report.malformed).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toEqual({
      title: "Unrewarded kill",
      severity: "high",
      evidence: [3, 4],
      rationale: "killPoints rose but credits did not change.",
    });
    expect(report.rawText).toBe(reply);
  });

  it("parses an explicit empty findings list as a clean (non-malformed) report", () => {
    const report = parseOddityReport('{"findings": []}');
    expect(report.malformed).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("extracts JSON wrapped in a ```json fence with surrounding prose", () => {
    const reply =
      "Here is my verdict:\n```json\n" +
      JSON.stringify({
        findings: [{ title: "Stuck", severity: "medium", evidence: [0], rationale: "no progress" }],
      }) +
      "\n```\nThat is all.";
    const report = parseOddityReport(reply);
    expect(report.malformed).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].title).toBe("Stuck");
  });

  it("accepts a bare array of findings (no wrapping object)", () => {
    const report = parseOddityReport(
      JSON.stringify([{ title: "X", severity: "low", evidence: [], rationale: "y" }]),
    );
    expect(report.malformed).toBe(false);
    expect(report.findings).toHaveLength(1);
  });

  it("snaps an unknown severity to medium and coerces messy evidence", () => {
    const report = parseOddityReport(
      JSON.stringify({
        findings: [
          { title: "T", severity: "catastrophic", evidence: ["2", 3.7, "nope"], rationale: "r" },
        ],
      }),
    );
    expect(report.findings[0].severity).toBe("medium");
    expect(report.findings[0].evidence).toEqual([2, 3]);
  });

  it("drops a finding with neither title nor rationale, keeps the others", () => {
    const report = parseOddityReport(
      JSON.stringify({
        findings: [
          { severity: "low", evidence: [] },
          { title: "Real one", severity: "high", evidence: [1], rationale: "ok" },
        ],
      }),
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].title).toBe("Real one");
  });

  it("degrades to a malformed report (no throw) on non-JSON prose", () => {
    const report = parseOddityReport("I could not find any oddities, sorry.");
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.rawText).toBe("I could not find any oddities, sorry.");
  });

  it("degrades to malformed (no throw) on an empty reply", () => {
    const report = parseOddityReport("");
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("degrades to malformed when JSON parses but the shape is wrong", () => {
    const report = parseOddityReport('{"findings": "none"}');
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("degrades to malformed (no throw) on truncated JSON", () => {
    const report = parseOddityReport('{"findings": [{"title": "x", "severity":');
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
  });
});

describe("judgeTranscript (end-to-end against FakeLlmClient)", () => {
  it("flags a planted oddity in a transcript", async () => {
    const transcript = mkTranscript({
      steps: [
        {
          index: 5,
          day: 3,
          scene: SceneType.SPACE_FLIGHT,
          action: { kind: "attack", targetId: "pirate-1" },
          vitalsDelta: {
            credits: 0, // killed it, got nothing
            hull: -10,
            fuel: 0,
            cargo: 0,
            reputationMin: 0,
            killPoints: 1,
          },
          notableLogs: ["[combat] pirate-1 destroyed"],
        },
      ],
    });
    const verdict = JSON.stringify({
      findings: [
        {
          title: "Kill paid no reward",
          severity: "high",
          evidence: [5],
          rationale: "killPoints rose at step 5 but credits stayed flat and no loot was collected.",
        },
      ],
    });
    const fake = new FakeLlmClient(verdict);

    const report = await judgeTranscript(fake, transcript);

    expect(report.malformed).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].evidence).toEqual([5]);
    expect(report.findings[0].severity).toBe("high");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].opts?.system).toBe(ODDITY_RUBRIC);
    expect(fake.calls[0].messages[0].content).toContain('"killPoints": 1');
  });

  it("returns no findings for a clean session", async () => {
    const fake = new FakeLlmClient('{"findings": []}');
    const report = await judgeTranscript(fake, mkTranscript());
    expect(report.malformed).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("degrades safely when the model returns garbage", async () => {
    const fake = new FakeLlmClient("the model rambled and produced no JSON");
    const report = await judgeTranscript(fake, mkTranscript());
    expect(report.malformed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("passes through model/maxTokens overrides to the client", async () => {
    const fake = new FakeLlmClient('{"findings": []}');
    await judgeTranscript(fake, mkTranscript(), { model: "claude-opus-4-8", maxTokens: 2048 });
    expect(fake.calls[0].opts?.model).toBe("claude-opus-4-8");
    expect(fake.calls[0].opts?.maxTokens).toBe(2048);
  });
});
