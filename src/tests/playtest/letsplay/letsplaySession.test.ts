import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import {
  runLetsplay,
  checkInvariants,
  formatLetsplayReport,
  writeLetsplayReport,
} from "./letsplay.run";
import type { Observation } from "./observe";

/**
 * Task 3 of the dev-only letsplay engine: the session runner + bug-discovery
 * report.
 *
 * Two tiers in one file:
 *  - the **always-on** fast session (part of `npm run test:playtest`, the pre-push
 *    gate): a short real-engine session completes with zero logged/thrown errors
 *    and zero always-actionable-invariant violations, and visibly moves the game;
 *  - the **env-gated full bug-finder** (`LETSPLAY_FULL=1`, driven by `npm run
 *    letsplay`): plays `K` sessions × `N` steps, writes the transcript + failure
 *    report to `.letsplay/`, and fails (non-zero exit) on any failure.
 *
 * Real `GameEngine` / `QuestManager` / `BankingService` / scene wiring — only
 * PixiJS is stubbed. The pixi mock here is what lets the (test-free) runner boot
 * the real harness headlessly.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** A minimal synthetic observation for the pure-invariant unit checks. */
function obs(partial: Partial<Observation>): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: {
      credits: 1000,
      hull: 100,
      maxHull: 100,
      hullFraction: 1,
      fuel: 50,
      maxFuel: 100,
      fuelFraction: 0.5,
      cargo: [],
      cargoUsed: 0,
      cargoCapacity: 20,
      systemId: "sys-1",
      position: { x: 0, y: 0 },
    },
    system: null,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: ["move", "wait"],
    ...partial,
  };
}

describe("checkInvariants (pure net)", () => {
  it("passes a sound state", () => {
    expect(checkInvariants(obs({}))).toEqual([]);
  });

  it("flags a stranded player — a non-terminal scene offering only wait", () => {
    const v = checkInvariants(obs({ legalActions: ["wait"] }));
    expect(v.map((x) => x.invariant)).toContain("always-actionable");
  });

  it("a terminal screen offering only wait is NOT a violation", () => {
    expect(
      checkInvariants(
        obs({ scene: SceneType.GAME_OVER, legalActions: ["wait"] }),
      ),
    ).toEqual([]);
  });

  it("flags corrupt vitals (negative / NaN hull, over-max hull)", () => {
    const neg = checkInvariants(
      obs({ player: { ...obs({}).player!, hull: -1, hullFraction: -0.01 } }),
    );
    expect(neg.map((x) => x.invariant)).toContain("hull-nonnegative");

    const over = checkInvariants(
      obs({
        player: {
          ...obs({}).player!,
          hull: 150,
          maxHull: 100,
          hullFraction: 1.5,
        },
      }),
    );
    expect(over.map((x) => x.invariant)).toContain("hull-within-max");
  });
});

describe("runLetsplay — short real-engine session", () => {
  it("completes with zero errors and zero invariant violations", async () => {
    const report = await runLetsplay({
      sessions: 1,
      steps: 20,
      seedPrefix: "LETSPLAY_FAST",
    });

    // The bug-finder found nothing — a clean run.
    expect(report.failures, formatLetsplayReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.totalSteps).toBe(20);
    expect(report.sessions).toHaveLength(1);

    // Non-degenerate: the agent actually played — it neither sat on «wait» the
    // whole time nor stayed in one scene.
    const [session] = report.sessions;
    expect(session.transcript).toHaveLength(20);
    const nonWait = session.transcript.filter((s) => s.action.kind !== "wait");
    expect(nonWait.length).toBeGreaterThan(0);
    const scenes = new Set(session.transcript.map((s) => s.scene));
    expect(scenes.size).toBeGreaterThanOrEqual(2);
  });

  it("a report with failures renders them and is not ok", () => {
    // formatLetsplayReport is the human surface the runner logs — prove it
    // surfaces a failure rather than silently swallowing it.
    const summary = formatLetsplayReport({
      sessions: [],
      totalSteps: 0,
      ok: false,
      failures: [
        {
          session: 0,
          kind: "invariant",
          step: 3,
          scene: SceneType.SPACE_FLIGHT,
          message: "always-actionable: player stranded",
        },
      ],
    });
    expect(summary).toContain("✗");
    expect(summary).toContain("always-actionable");
  });
});

/**
 * The full bug-finder, opt-in via `LETSPLAY_FULL` so the always-on playtest gate
 * stays fast. `npm run letsplay` sets it: plays `K`×`N`, writes `.letsplay/`
 * artifacts, and the assertion below turns any failure into a non-zero exit.
 * `LETSPLAY_SESSIONS` / `LETSPLAY_STEPS` override the K/N defaults.
 */
const FULL = !!process.env.LETSPLAY_FULL;
describe.runIf(FULL)("npm run letsplay — full bug-finder", () => {
  it("plays K sessions × N steps with zero failures (writes a report)", async () => {
    const sessions = Number(process.env.LETSPLAY_SESSIONS ?? 3);
    const steps = Number(process.env.LETSPLAY_STEPS ?? 40);

    const report = await runLetsplay({ sessions, steps });
    const written = writeLetsplayReport(report);
    // Surface the summary + where the full report landed for the dev driver.
    // eslint-disable-next-line no-console
    console.log(
      `${formatLetsplayReport(report)}\n  report: ${written.reportPath}`,
    );

    expect(report.failures, formatLetsplayReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);
});
