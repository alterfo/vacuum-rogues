import { describe, it, expect, afterEach, vi } from "vitest";
import { SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { PlayerAgent } from "./PlayerAgent";
import type { AgentRunResult, AgentStep, StepVitals } from "./PlayerAgent";
import type { Action } from "./PlayerPolicy";
import { buildTranscript, serializeTranscript } from "./transcript";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function mkVitals(over: Partial<StepVitals> = {}): StepVitals {
  return {
    credits: 1000,
    hull: 100,
    maxHull: 100,
    fuel: 50,
    cargoUsed: 0,
    reputationMin: 0,
    killPoints: 0,
    questsActive: 0,
    questsCompleted: 0,
    ...over,
  };
}

function mkStep(
  index: number,
  action: Action,
  vitals: StepVitals,
  over: Partial<AgentStep> = {},
): AgentStep {
  return {
    index,
    scene: SceneType.SPACE_FLIGHT,
    action,
    day: 0,
    vitals,
    ...over,
  };
}

describe("buildTranscript (pure)", () => {
  it("folds a scripted run into per-step records with the expected vitals deltas", () => {
    const result: AgentRunResult = {
      steps: [
        mkStep(0, { kind: "move" }, mkVitals({ credits: 1000 }), { day: 0 }),
        mkStep(
          1,
          { kind: "trade", targetId: "p1", reason: "buy low" },
          mkVitals({ credits: 1200, fuel: 40 }),
          { day: 2 },
        ),
      ],
      errors: [],
      endScene: SceneType.PLANET,
      finalDay: 5,
      finalVitals: mkVitals({ credits: 1500, fuel: 30, killPoints: 4 }),
    };

    const t = buildTranscript({ seed: "SEED-1", result, policy: "heuristic" });

    expect(t.seed).toBe("SEED-1");
    expect(t.policy).toBe("heuristic");
    expect(t.steps).toHaveLength(2);

    expect(t.steps[0].vitalsDelta.credits).toBe(200);
    expect(t.steps[0].vitalsDelta.fuel).toBe(-10);
    expect(t.steps[0].day).toBe(0);
    expect(t.steps[0].action).toEqual({ kind: "move" });

    expect(t.steps[1].vitalsDelta.credits).toBe(300);
    expect(t.steps[1].vitalsDelta.killPoints).toBe(4);
    expect(t.steps[1].action).toEqual({
      kind: "trade",
      targetId: "p1",
      reason: "buy low",
    });
  });

  it("computes the session summary (days, curves, kills, quests)", () => {
    const result: AgentRunResult = {
      steps: [
        mkStep(
          0,
          { kind: "take-quest" },
          mkVitals({ credits: 1000, reputationMin: 0, questsCompleted: 0 }),
          { day: 0 },
        ),
        mkStep(
          1,
          { kind: "move" },
          mkVitals({ credits: 900, reputationMin: -10, questsCompleted: 0 }),
          { day: 3 },
        ),
        mkStep(
          2,
          { kind: "take-quest" },
          mkVitals({
            credits: 1400,
            reputationMin: -10,
            killPoints: 2,
            questsCompleted: 1,
          }),
          { day: 6 },
        ),
      ],
      errors: [],
      endScene: SceneType.SPACE_FLIGHT,
      finalDay: 8,
      finalVitals: mkVitals({
        credits: 1600,
        reputationMin: -20,
        killPoints: 5,
        questsCompleted: 2,
      }),
    };

    const t = buildTranscript({ seed: "SEED-2", result });

    expect(t.summary.steps).toBe(3);
    expect(t.summary.daysElapsed).toBe(8); // finalDay 8 − firstDay 0
    expect(t.summary.survived).toBe(true);
    expect(t.summary.deaths).toBe(0);
    expect(t.summary.creditsCurve).toEqual([1000, 900, 1400, 1600]);
    expect(t.summary.reputationCurve).toEqual([0, -10, -10, -20]);
    expect(t.summary.netCredits).toBe(600); // 1600 − 1000
    expect(t.summary.killPointsGained).toBe(5); // 5 − 0
    expect(t.summary.questsTaken).toBe(2); // two take-quest actions
    expect(t.summary.questsCompleted).toBe(2); // 2 − 0
    expect(t.summary.totalErrors).toBe(0);
  });

  it("flags a death (GAME_OVER) in the summary", () => {
    const result: AgentRunResult = {
      steps: [mkStep(0, { kind: "move" }, mkVitals())],
      errors: [],
      endScene: SceneType.GAME_OVER,
      finalDay: 1,
      finalVitals: mkVitals({ hull: 0 }),
    };
    const t = buildTranscript({ seed: "DEAD", result });
    expect(t.summary.survived).toBe(false);
    expect(t.summary.deaths).toBe(1);
  });

  it("carries notable log lines through onto the step", () => {
    const result: AgentRunResult = {
      steps: [
        mkStep(0, { kind: "move" }, mkVitals(), {
          notableLogs: ["[logger] something broke"],
        }),
      ],
      errors: [{ source: "logger", message: "something broke" }],
      endScene: SceneType.SPACE_FLIGHT,
      finalVitals: mkVitals(),
    };
    const t = buildTranscript({ seed: "LOG", result });
    expect(t.steps[0].notableLogs).toEqual(["[logger] something broke"]);
    expect(t.summary.totalErrors).toBe(1);
  });

  it("degrades safely when no vitals were captured (no throw, zero deltas)", () => {
    const result: AgentRunResult = {
      steps: [
        {
          index: 0,
          scene: SceneType.MAIN_MENU,
          action: { kind: "wait" },
          day: 0,
        },
      ],
      errors: [],
      endScene: SceneType.MAIN_MENU,
    };
    const t = buildTranscript({ seed: "EMPTY", result });
    expect(t.steps[0].vitalsDelta.credits).toBe(0);
    expect(t.summary.creditsCurve).toEqual([]);
    expect(t.summary.netCredits).toBe(0);
    expect(t.summary.daysElapsed).toBe(0);
  });

  it("serialises to stable JSON (two builds of one run are byte-identical)", () => {
    const result: AgentRunResult = {
      steps: [
        mkStep(0, { kind: "land", targetId: "p1" }, mkVitals(), { day: 0 }),
        mkStep(1, { kind: "trade" }, mkVitals({ credits: 1100 }), { day: 1 }),
      ],
      errors: [],
      endScene: SceneType.PLANET,
      finalDay: 2,
      finalVitals: mkVitals({ credits: 1200 }),
    };
    const a = serializeTranscript(buildTranscript({ seed: "S", result }));
    const b = serializeTranscript(buildTranscript({ seed: "S", result }));
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual(buildTranscript({ seed: "S", result }));
  });
});

describe("PlayerAgent emits the richer record (real harness)", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("records day + vitals per step and builds a coherent transcript", async () => {
    harness = await RealEngineHarness.boot({ seed: "TRANSCRIPT_REC" });
    await harness.newGame();
    const agent = new PlayerAgent(harness, new HeuristicPolicy());

    const result = await agent.run(12);

    expect(result.errors).toEqual([]);
    expect(result.steps).toHaveLength(12);
    for (const s of result.steps) {
      expect(typeof s.day).toBe("number");
      expect(s.vitals).toBeDefined();
      expect(Number.isFinite(s.vitals!.credits)).toBe(true);
    }
    expect(result.finalVitals).toBeDefined();

    const t = buildTranscript({
      seed: "TRANSCRIPT_REC",
      result,
      policy: "heuristic",
    });
    expect(t.summary.steps).toBe(12);
    expect(t.steps).toHaveLength(12);
    expect(t.summary.creditsCurve).toHaveLength(13);
    expect(() => serializeTranscript(t)).not.toThrow();
  });
});
