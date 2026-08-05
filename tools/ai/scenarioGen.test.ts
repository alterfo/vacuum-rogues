import { describe, it, expect } from "vitest";
import { FakeLlmClient } from "./llmClient";
import {
  SCENARIO_RUBRIC,
  SCENARIO_GOALS,
  DEFAULT_SCENARIO_MAX_DAYS,
  SCENARIO_MAX_DAYS_CAP,
  buildScenarioPrompt,
  parseScenarios,
  generateScenarios,
} from "./scenarioGen";

describe("buildScenarioPrompt", () => {
  it("uses the rubric as the system prompt and asks for the requested count", () => {
    const { system, messages } = buildScenarioPrompt(7);
    expect(system).toBe(SCENARIO_RUBRIC);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("7");
  });

  it("rubric enumerates the exact fixed goal set the agent understands", () => {
    for (const goal of SCENARIO_GOALS) expect(SCENARIO_RUBRIC).toContain(goal);
  });

  it("falls back to a sane count for a non-positive request", () => {
    expect(buildScenarioPrompt(0).messages[0].content).toContain("5");
    expect(buildScenarioPrompt(-3).messages[0].content).toContain("5");
  });
});

describe("parseScenarios", () => {
  it("parses a well-formed scenario list with all fields", () => {
    const reply = JSON.stringify({
      scenarios: [
        { name: "Bankrupt run", goal: "go-broke", maxDays: 30, seed: "AAA" },
        { name: "Roam", goal: "free-explore", maxDays: 120 },
      ],
    });
    const out = parseScenarios(reply);
    expect(out).toEqual([
      { name: "Bankrupt run", goal: "go-broke", maxDays: 30, seed: "AAA" },
      { name: "Roam", goal: "free-explore", maxDays: 120 },
    ]);
  });

  it("drops a scenario with an unknown goal but keeps the valid ones", () => {
    const reply = JSON.stringify({
      scenarios: [
        { name: "Bad", goal: "conquer-galaxy", maxDays: 10 },
        { name: "Good", goal: "max-rep", maxDays: 40 },
      ],
    });
    const out = parseScenarios(reply);
    expect(out).toHaveLength(1);
    expect(out[0].goal).toBe("max-rep");
  });

  it("accepts a bare array of scenarios (no wrapping object)", () => {
    const out = parseScenarios(
      JSON.stringify([{ name: "H", goal: "hoard", maxDays: 25 }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].goal).toBe("hoard");
  });

  it("extracts JSON wrapped in a ```json fence with surrounding prose", () => {
    const reply =
      "Sure! Here is the curriculum:\n```json\n" +
      JSON.stringify({ scenarios: [{ name: "I", goal: "ignore-overmind", maxDays: 200 }] }) +
      "\n```\nEnjoy.";
    const out = parseScenarios(reply);
    expect(out).toHaveLength(1);
    expect(out[0].goal).toBe("ignore-overmind");
    expect(out[0].maxDays).toBe(200);
  });

  it("defaults a missing/invalid maxDays and a missing name", () => {
    const out = parseScenarios(
      JSON.stringify({ scenarios: [{ goal: "hoard" }, { goal: "max-rep", maxDays: "lots" }] }),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("scenario-hoard");
    expect(out[0].maxDays).toBe(DEFAULT_SCENARIO_MAX_DAYS);
    expect(out[0].seed).toBeUndefined();
    expect(out[1].maxDays).toBe(DEFAULT_SCENARIO_MAX_DAYS);
  });

  it("clamps an absurd maxDays to the cap and a fractional one to an integer", () => {
    const out = parseScenarios(
      JSON.stringify({
        scenarios: [
          { goal: "go-broke", maxDays: 999999 },
          { goal: "hoard", maxDays: 12.9 },
        ],
      }),
    );
    expect(out[0].maxDays).toBe(SCENARIO_MAX_DAYS_CAP);
    expect(out[1].maxDays).toBe(12);
  });

  it("normalises goal casing/whitespace", () => {
    const out = parseScenarios(
      JSON.stringify({ scenarios: [{ goal: "  Free-Explore ", maxDays: 10 }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].goal).toBe("free-explore");
  });

  it("degrades to [] (no throw) on non-JSON prose", () => {
    expect(parseScenarios("I think you should just play normally.")).toEqual([]);
  });

  it("degrades to [] (no throw) on an empty reply", () => {
    expect(parseScenarios("")).toEqual([]);
  });

  it("degrades to [] when JSON parses but the shape is wrong", () => {
    expect(parseScenarios('{"scenarios": "none"}')).toEqual([]);
  });

  it("degrades to [] (no throw) on truncated JSON", () => {
    expect(parseScenarios('{"scenarios": [{"goal": "hoard", "maxDays":')).toEqual([]);
  });
});

describe("generateScenarios (end-to-end against FakeLlmClient)", () => {
  it("requests scenarios and parses the (faked) reply into configs", async () => {
    const reply = JSON.stringify({
      scenarios: [
        { name: "Go broke", goal: "go-broke", maxDays: 30 },
        { name: "Max rep", goal: "max-rep", maxDays: 60 },
        { name: "Ignore the war", goal: "ignore-overmind", maxDays: 200 },
      ],
    });
    const fake = new FakeLlmClient(reply);

    const out = await generateScenarios(fake, 3);

    expect(out).toHaveLength(3);
    expect(out.map((s) => s.goal)).toEqual([
      "go-broke",
      "max-rep",
      "ignore-overmind",
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].opts?.system).toBe(SCENARIO_RUBRIC);
    expect(fake.calls[0].messages[0].content).toContain("3");
  });

  it("returns [] when the model returns garbage (never throws)", async () => {
    const fake = new FakeLlmClient("no scenarios for you");
    expect(await generateScenarios(fake, 5)).toEqual([]);
  });

  it("passes through model/maxTokens overrides to the client", async () => {
    const fake = new FakeLlmClient('{"scenarios": []}');
    await generateScenarios(fake, 2, { model: "claude-opus-4-8", maxTokens: 1024 });
    expect(fake.calls[0].opts?.model).toBe("claude-opus-4-8");
    expect(fake.calls[0].opts?.maxTokens).toBe(1024);
  });
});
