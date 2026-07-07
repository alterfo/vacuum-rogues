/**
 * Task 16b (three-year-campaign) — the closing "re-run a 3-session live
 * smoke" checkbox. A real browser session isn't available headlessly, so
 * this drives the "real-scene playtest equivalent" the plan itself allows:
 * the real `SpaceFlightScene`/`GameEngine` (pixi-stubbed) through the exact
 * `observe → updateMemory → decide → applyLiveAction` loop the live
 * `AutopilotController` runs, for a long-enough horizon to exercise the F1/
 * F6/F7/F8/F10 fixes landed in this task. Not a permanent CI gate (no fixed
 * win-rate/day assertions — Task 9 already established those need the
 * user's deferred architectural decision); this is the "prove the specific
 * live-session failures are gone" smoke, recorded per-session in the plan.
 */
import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { SceneType } from "@/types";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import {
  createMemory,
  updateMemory,
  questBaselineForObserve,
  type AgentMemory,
} from "./AgentMemory";
import { observe } from "./observe";
import { applyLiveAction } from "./LiveApplier";
import { createLiveSceneController } from "./installAutopilotHook";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

/** One live session: drives the real engine via the live controller for `steps` folds. */
async function runLiveSession(seed: string, steps: number) {
  const harness = await RealEngineHarness.boot({ seed, systemCount: 24 });
  try {
    await harness.newGame();
    const engine = harness.engine;
    const controller = createLiveSceneController(engine, () => memory);
    const policy = new MemoryHeuristicPolicy();
    let memory: AgentMemory = createMemory();

    const systemIdSequence: string[] = [];
    let maxDaySeen = 0;

    for (let i = 0; i < steps; i++) {
      const baseline = questBaselineForObserve(memory, engine);
      const obs = observe(engine, baseline);
      memory = updateMemory(memory, obs);
      if (obs.system) systemIdSequence.push(obs.system.id);
      if (obs.gameDay !== undefined)
        maxDaySeen = Math.max(maxDaySeen, obs.gameDay);

      const action = policy.decide(obs, memory);
      await applyLiveAction(action, obs, controller);
      // Advance the rAF-equivalent a few frames per fold, like the real
      // ~800ms autopilot tick would let the engine simulate between decisions.
      for (let f = 0; f < 4; f++) harness.tick(200);
    }

    return {
      errors: harness.errors(),
      maxDaySeen,
      finalGameDays: harness.galaxy()?.gameDays ?? 0,
      overmindArc: harness.galaxy()?.overmindArc,
      playerLiberations: harness.galaxy()?.overmindArc.playerLiberations ?? 0,
      systemIdSequence,
      died: harness.currentSceneType() === SceneType.GAME_OVER,
    };
  } finally {
    harness.dispose();
  }
}

/** Longest run of `a-b-a-b...` alternation between exactly two systems. */
function longestTwoSystemPingPong(seq: string[]): number {
  let best = 1;
  let run = 1;
  for (let i = 2; i < seq.length; i++) {
    if (seq[i] === seq[i - 2] && seq[i] !== seq[i - 1]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

describe("Task 16b — live smoke (real-scene playtest equivalent)", () => {
  it("session 1 (LIVE-SMOKE-16B-1): no day-0 deadlock, no unearned win, bounded ping-pong", async () => {
    const r = await runLiveSession("LIVE-SMOKE-16B-1", 150);
    console.log(
      `[LIVE-SMOKE-16B-1] maxDay=${r.maxDaySeen} finalDays=${r.finalGameDays} arc=${r.overmindArc?.status} playerLiberations=${r.playerLiberations} pingPong=${longestTwoSystemPingPong(r.systemIdSequence)} died=${r.died}`,
    );
    expect(r.errors, formatRecorded(r.errors)).toEqual([]);
    // F7: the calendar must actually advance, not freeze at day 0.
    expect(r.maxDaySeen).toBeGreaterThan(0);
    // F10: a win must never fire without genuine player participation.
    if (r.overmindArc?.status === "won") {
      expect(r.playerLiberations).toBeGreaterThan(0);
    }
    // F1: no pathological 2-system ping-pong dominating the whole session.
    expect(longestTwoSystemPingPong(r.systemIdSequence)).toBeLessThan(30);
  }, 60_000);

  it("session 2 (LIVE-SMOKE-16B-2): no day-0 deadlock, no unearned win, bounded ping-pong", async () => {
    const r = await runLiveSession("LIVE-SMOKE-16B-2", 150);
    console.log(
      `[LIVE-SMOKE-16B-2] maxDay=${r.maxDaySeen} finalDays=${r.finalGameDays} arc=${r.overmindArc?.status} playerLiberations=${r.playerLiberations} pingPong=${longestTwoSystemPingPong(r.systemIdSequence)} died=${r.died}`,
    );
    expect(r.errors, formatRecorded(r.errors)).toEqual([]);
    expect(r.maxDaySeen).toBeGreaterThan(0);
    if (r.overmindArc?.status === "won") {
      expect(r.playerLiberations).toBeGreaterThan(0);
    }
    expect(longestTwoSystemPingPong(r.systemIdSequence)).toBeLessThan(30);
  }, 60_000);

  it("session 3 (LIVE-SMOKE-16B-3): no day-0 deadlock, no unearned win, bounded ping-pong", async () => {
    const r = await runLiveSession("LIVE-SMOKE-16B-3", 150);
    console.log(
      `[LIVE-SMOKE-16B-3] maxDay=${r.maxDaySeen} finalDays=${r.finalGameDays} arc=${r.overmindArc?.status} playerLiberations=${r.playerLiberations} pingPong=${longestTwoSystemPingPong(r.systemIdSequence)} died=${r.died}`,
    );
    expect(r.errors, formatRecorded(r.errors)).toEqual([]);
    expect(r.maxDaySeen).toBeGreaterThan(0);
    if (r.overmindArc?.status === "won") {
      expect(r.playerLiberations).toBeGreaterThan(0);
    }
    expect(longestTwoSystemPingPong(r.systemIdSequence)).toBeLessThan(30);
  }, 60_000);
});
