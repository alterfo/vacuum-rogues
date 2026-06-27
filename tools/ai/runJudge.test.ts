/**
 * Tests for the offline `letsplay:judge` runner (Task 5). Everything is
 * deterministic and free: a **fake** {@link PlayFn} returns hand-built transcripts
 * (no engine) and the {@link FakeLlmClient} returns canned judge / scenario
 * replies (no live API call, no key). So spec building, the judge glue, the
 * consolidation, the formatter, and the file write are all asserted in isolation.
 *
 * The engine-bound real play lives in the gated `judge.run.test.ts` vitest runner
 * (which `npm run letsplay:judge` drives with a real key); here we prove the
 * orchestration is correct without it.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SceneType } from "@/types";
import { FakeLlmClient } from "./llmClient";
import {
  buildPlaySpecs,
  judgeTranscripts,
  runJudge,
  formatJudgeReport,
  writeJudgeReport,
  type JudgeSessionInput,
  type PlayFn,
  type PlaySpec,
} from "./runJudge";
import type { ScenarioConfig } from "./scenarioGen";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../src/tests/playtest/letsplay/transcript";

/** A minimal valid transcript, overridable per field. */
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
  return {
    seed: "SEED",
    policy: "heuristic",
    ...over,
    summary,
    steps: over.steps ?? [],
  };
}

/** A canned judge reply flagging one oddity. */
const FINDING_REPLY = JSON.stringify({
  findings: [
    {
      title: "Unrewarded kill",
      severity: "high",
      evidence: [3],
      rationale: "killPoints rose but credits did not change.",
    },
  ],
});

/** A canned judge reply with no oddities. */
const CLEAN_REPLY = JSON.stringify({ findings: [] });

/** The scenario rubric is distinguished by its "test curriculum" phrasing. */
function isScenarioCall(system?: string): boolean {
  return !!system && system.includes("test curriculum");
}

describe("buildPlaySpecs", () => {
  it("builds K free-play specs seeded <prefix>-<i> when no scenarios", () => {
    const specs = buildPlaySpecs({
      sessions: 3,
      steps: 25,
      seedPrefix: "JX",
    });
    expect(specs).toEqual([
      { seed: "JX-0", steps: 25 },
      { seed: "JX-1", steps: 25 },
      { seed: "JX-2", steps: 25 },
    ]);
  });

  it("builds one spec per scenario, scenario seed winning over the prefix", () => {
    const scenarios: ScenarioConfig[] = [
      { name: "broke run", goal: "go-broke", maxDays: 30, seed: "FIXED" },
      { name: "roam", goal: "free-explore", maxDays: 50 },
    ];
    const specs = buildPlaySpecs({
      sessions: 99, // ignored when scenario-driven
      steps: 40,
      seedPrefix: "JX",
      scenarios,
    });
    expect(specs).toEqual([
      { seed: "FIXED", steps: 40, scenario: scenarios[0] },
      { seed: "JX-free-explore-1", steps: 40, scenario: scenarios[1] },
    ]);
  });
});

describe("judgeTranscripts", () => {
  it("judges each transcript and consolidates findings by severity", async () => {
    const items: JudgeSessionInput[] = [
      { transcript: mkTranscript({ seed: "A" }) },
      { transcript: mkTranscript({ seed: "B" }) },
    ];
    // First session flagged, second clean (responses returned in order).
    const client = new FakeLlmClient([FINDING_REPLY, CLEAN_REPLY]);

    const report = await judgeTranscripts(client, items, {
      now: () => "FIXED-TS",
    });

    expect(report.generatedAt).toBe("FIXED-TS");
    expect(report.totalSessions).toBe(2);
    expect(report.totalFindings).toBe(1);
    expect(report.malformedReplies).toBe(0);
    expect(report.bySeverity.high).toBe(1);
    expect(report.bySeverity.low).toBe(0);
    expect(report.sessions[0].seed).toBe("A");
    expect(report.sessions[0].report.findings[0].title).toBe("Unrewarded kill");
    expect(report.sessions[1].report.findings).toEqual([]);
    // Each transcript was sent once.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].messages[0].content).toContain('"seed": "A"');
  });

  it("counts a malformed reply without throwing", async () => {
    const items: JudgeSessionInput[] = [{ transcript: mkTranscript() }];
    const client = new FakeLlmClient("not json at all");

    const report = await judgeTranscripts(client, items, {
      now: () => "TS",
    });

    expect(report.malformedReplies).toBe(1);
    expect(report.totalFindings).toBe(0);
    expect(report.sessions[0].report.malformed).toBe(true);
  });

  it("carries scenario identity into the judged session", async () => {
    const scenario: ScenarioConfig = {
      name: "broke run",
      goal: "go-broke",
      maxDays: 30,
    };
    const items: JudgeSessionInput[] = [
      { transcript: mkTranscript({ seed: "S" }), scenario },
    ];
    const client = new FakeLlmClient(CLEAN_REPLY);

    const report = await judgeTranscripts(client, items, { now: () => "TS" });

    expect(report.sessions[0].scenario).toBe("broke run");
    expect(report.sessions[0].goal).toBe("go-broke");
  });
});

describe("runJudge — end-to-end with a fake play + fake client", () => {
  /** A fake play that fabricates one transcript per spec (no engine). */
  const fakePlay: PlayFn = async (specs: PlaySpec[]) =>
    specs.map((s) => ({
      transcript: mkTranscript({ seed: s.seed }),
      ...(s.scenario ? { scenario: s.scenario } : {}),
    }));

  it("plays K free-play sessions and produces a consolidated report", async () => {
    const client = new FakeLlmClient([FINDING_REPLY, CLEAN_REPLY]);

    const report = await runJudge({
      client,
      play: fakePlay,
      sessions: 2,
      steps: 10,
      seedPrefix: "RUN",
      now: () => "TS",
    });

    expect(report.totalSessions).toBe(2);
    expect(report.totalFindings).toBe(1);
    expect(report.sessions.map((s) => s.seed)).toEqual(["RUN-0", "RUN-1"]);
    // Free-play: no scenario identity.
    expect(report.sessions.every((s) => s.scenario === undefined)).toBe(true);
  });

  it("when useScenarios, asks the LLM for scenarios then plays them goal-biased", async () => {
    const scenariosReply = JSON.stringify({
      scenarios: [
        { name: "go bust", goal: "go-broke", maxDays: 30 },
        { name: "roam", goal: "free-explore", maxDays: 50, seed: "ROAM" },
      ],
    });
    // The first call (scenario rubric) yields scenarios; the rest are judge calls.
    const client = new FakeLlmClient((messages, opts) =>
      isScenarioCall(opts?.system) ? scenariosReply : CLEAN_REPLY,
    );

    const report = await runJudge({
      client,
      play: fakePlay,
      sessions: 2,
      steps: 10,
      seedPrefix: "RUN",
      useScenarios: true,
      now: () => "TS",
    });

    expect(report.totalSessions).toBe(2);
    expect(report.sessions[0].scenario).toBe("go bust");
    expect(report.sessions[0].goal).toBe("go-broke");
    expect(report.sessions[0].seed).toBe("RUN-go-broke-0");
    expect(report.sessions[1].seed).toBe("ROAM");
    // 1 scenario call + 2 judge calls.
    expect(client.calls).toHaveLength(3);
  });

  it("explicit scenarios skip generation entirely", async () => {
    const scenarios: ScenarioConfig[] = [
      { name: "hoard it", goal: "hoard", maxDays: 40 },
    ];
    const client = new FakeLlmClient(CLEAN_REPLY);

    const report = await runJudge({
      client,
      play: fakePlay,
      scenarios,
      steps: 10,
      now: () => "TS",
    });

    expect(report.totalSessions).toBe(1);
    expect(report.sessions[0].goal).toBe("hoard");
    // Only the judge call — no scenario-generation call was made.
    expect(client.calls).toHaveLength(1);
  });
});

describe("formatJudgeReport", () => {
  it("renders the verdict, severity histogram, and per-session findings", async () => {
    const items: JudgeSessionInput[] = [{ transcript: mkTranscript({ seed: "Z" }) }];
    const client = new FakeLlmClient(FINDING_REPLY);
    const report = await judgeTranscripts(client, items, { now: () => "TS" });

    const text = formatJudgeReport(report);
    expect(text).toContain("⚠ Oddity judge");
    expect(text).toContain("high=1");
    expect(text).toContain("[Z]");
    expect(text).toContain("Unrewarded kill");
  });

  it("a clean report renders the ✓ verdict and no findings", async () => {
    const items: JudgeSessionInput[] = [{ transcript: mkTranscript() }];
    const client = new FakeLlmClient(CLEAN_REPLY);
    const report = await judgeTranscripts(client, items, { now: () => "TS" });
    expect(formatJudgeReport(report)).toContain("✓ Oddity judge");
  });
});

describe("writeJudgeReport", () => {
  it("writes the JSON report + the text summary to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-"));
    try {
      const items: JudgeSessionInput[] = [
        { transcript: mkTranscript({ seed: "W" }) },
      ];
      const client = new FakeLlmClient(FINDING_REPLY);
      const report = await judgeTranscripts(client, items, { now: () => "TS" });

      const written = writeJudgeReport(report, dir);
      expect(written.reportPath).toBe(join(dir, "oddity-report.json"));
      expect(written.summaryPath).toBe(join(dir, "oddity-report.txt"));

      const json = JSON.parse(readFileSync(written.reportPath, "utf8"));
      expect(json.totalFindings).toBe(1);
      expect(json.generatedAt).toBe("TS");
      expect(readFileSync(written.summaryPath, "utf8")).toContain(
        "Unrewarded kill",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
