import { describe, it, expect, vi } from "vitest";
import {
  runLetsplayCi,
  formatCiResult,
  DEFAULT_CI_THRESHOLDS,
} from "../playtest/letsplay/ci.run";

// The real harness (RealEngineHarness → GameEngine) needs PixiJS stubbed to
// boot headlessly under vitest, same as every other real-engine letsplay test.
vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

/**
 * Task 8 — the session oracle scores the play the **needs-based**
 * `MemoryHeuristicPolicy` (Tasks 1–7) now reliably reaches: it lands to
 * refuel, avoids the Overmind front, and explores instead of warp-looping —
 * states the old dumb heuristic never got to, so `ci.run.ts`'s
 * `DEFAULT_CI_THRESHOLDS` never scored them (memory
 * `feedback-letsplay-oddity-hunting`: the oracle must catch balance/logic
 * cringe reachable *now*, not just crashes).
 *
 * `minDaysSurvived`/`minAvgDistinctSystemsVisited` are scored **here**
 * rather than folded into the shared `DEFAULT_CI_THRESHOLDS` because they are
 * budget-dependent — `ci.run.test.ts`'s own tiny smoke runs (1 session × 1–12
 * steps) legitimately never leave the start system, and that file's default
 * must stay clean for them. This file plays a properly-sized budget and owns
 * the floors that only make sense at that size.
 */
describe("Task 8 — the needs-based agent reaches competent, explorable, survivable play", () => {
  it("never starves out, never loses the galaxy, explores, and survives a real horizon", async () => {
    const r = await runLetsplayCi({
      sessions: 3,
      steps: 40,
      seedPrefix: "SESSION_ORACLE",
      thresholds: {
        ...DEFAULT_CI_THRESHOLDS,
        minDaysSurvived: 1,
        minAvgDistinctSystemsVisited: 1.5,
      },
    });

    // No fuel-death — Task 1's survival tier lands to refuel before empty.
    expect(r.run.fuelDeathCount, formatCiResult(r)).toBe(0);
    // No negative credits — a corrupt-vital invariant breach (checkInvariants'
    // credits-nonnegative), not just a NaN.
    expect(r.run.totalInvariantViolations, formatCiResult(r)).toBe(0);
    // The galaxy is never lost to the Overmind while this agent is playing —
    // Task 3's threat tier flees a rising front instead of idling into it.
    expect(r.run.overmindLossCount, formatCiResult(r)).toBe(0);
    // A real, non-trivial horizon survived — not a stall at day zero.
    expect(r.run.minDaysSurvived, formatCiResult(r)).toBeGreaterThanOrEqual(1);
    // Genuine exploration — Task 5's smart warp targeting visits more than the
    // start system, not a single-system warp-in-place loop.
    expect(
      r.run.avgDistinctSystemsVisited,
      formatCiResult(r),
    ).toBeGreaterThanOrEqual(1.5);

    expect(r.result.reasons, formatCiResult(r)).toEqual([]);
    expect(r.ok, formatCiResult(r)).toBe(true);
  }, 60_000);
});
